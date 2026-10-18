// Bangumi may connect two TV seasons through a film. Traverse those links,
// but only add serial animation; keep a film only if it is already collected.
export function isSeasonSubject(subject) {
  const title = subject.name_cn || subject.name || '';
  const episodes=Number(subject.total_episodes||subject.eps||0);
  if(episodes>0 && episodes<=4 && ![376739,415779].includes(subject.id))return false;
  return subject.type === 2 && ['TV', 'WEB'].includes(subject.platform)
    && !/特别篇|特別編|特別编集|新编集|番外|总集|総集|样片|迷你|小剧场|PROLOGUE|memories|Dark Sun|Stars and Ours|First Order|Whispers of Dawn|黎明低语|圣战的预兆|(?:^|\s)SP(?:\s|$)/i.test(title);
}

export function sameTimeline(a, b) {
  const fateBranch = x => (x.name || x.original || x.name_cn || x.title || '').match(/Fate\/(stay night|Zero|Grand Order|Apocrypha|EXTRA|strange Fake)/i)?.[1].toLowerCase();
  const left = fateBranch(a), right = fateBranch(b);
  return !(left && right && left !== right);
}

export async function discoverSeasons(seed, request, { limit = 120 } = {}) {
  const subjects = new Map([[seed.id, seed]]), links = [], queue = [seed.id];
  for (let cursor = 0; cursor < queue.length; cursor++) {
    const id = queue[cursor], current = subjects.get(id);
    const related = await request(`/v0/subjects/${id}/subjects`);
    for (const relation of related) {
      if (relation.type !== 2 || !['前传', '续集'].includes(relation.relation)) continue;
      if (!subjects.has(relation.id)) {
        const subject = await request(`/v0/subjects/${relation.id}`);
        if (!sameTimeline(current, subject)) continue;
        if (subjects.size >= limit) throw new Error('系列条目过多，请分批添加；本次尚未保存');
        subjects.set(subject.id, subject); queue.push(subject.id);
      }
      if (sameTimeline(current, subjects.get(relation.id))) links.push([id, relation.id]);
    }
  }
  return { subjects: [...subjects.values()], links };
}

const digits = {一:1,二:2,三:3,四:4,五:5,六:6,七:7,八:8,九:9,十:10};
function number(value) {
  if (/^\d+$/.test(value)) return Number(value);
  if (value.length === 1) return digits[value];
  if (value.startsWith('十')) return 10 + (digits[value[1]] || 0);
  return (digits[value[0]] || 0) * 10 + (digits[value[2]] || 0);
}
const chinese = n => n <= 10 ? Object.keys(digits).find(key => digits[key] === n) : String(n);
const numberedParts = new Map([
  [23686,1],[92382,2],[225604,3],[279457,3],[292238,3],
  [55770,1],[118335,2],[217300,3],[263750,3],[285666,4],[331752,4],[376739,4],[415779,4],
  [43558,1],[85631,2],[113292,2],[150490,3],[235128,4],[332261,5],[375913,5],[395782,5],
  [84171,1],[120236,2],[173849,3],[269918,4],[295421,4],
  [330057,2],[403225,2],
]);
const baseOverrides=new Map([[248175,'辉夜大小姐想让我告白'],[277554,'无职转生'],[240038,'青春猪头少年'],[354190,'明日方舟'],[56093,'弹丸论破'],[428735,'BanG Dream!']]);

export function baseTitle(title) {
  return title.replace(/\s*第[一二三四五六七八九十\d]+[季期].*$/, '').trim();
}

function stripBase(title,base) {
  const significant=char=>/[\p{L}\p{N}]/u.test(char);
  const target=[...base].filter(significant).join('').toLowerCase();
  let matched='',end=0;
  for(const char of title){end+=char.length;if(significant(char))matched+=char.toLowerCase();if(matched===target)return title.slice(end);if(!target.startsWith(matched))return null;}
  return null;
}

export function organizeEntries(entries, subjects, links) {
  const details = new Map(subjects.map(x => [x.id, x]));
  const parent = new Map();
  const find = id => { if (!parent.has(id)) parent.set(id,id); if (parent.get(id)!==id) parent.set(id,find(parent.get(id))); return parent.get(id); };
  for (const [a,b] of links) if (details.has(a) && details.has(b) && sameTimeline(details.get(a),details.get(b))) parent.set(find(a),find(b));
  const groups = new Map();
  for (const entry of entries) { const root=find(entry.id); if(!groups.has(root))groups.set(root,[]);groups.get(root).push(entry); }
  const result=[];
  for (const members of groups.values()) {
    members.sort((a,b)=>(a.date||'9999').localeCompare(b.date||'9999') || a.id-b.id);
    const serial=members.filter(x=>isSeasonSubject(details.get(x.id)||{}));
    if (members.length < 2) { result.push(...members); continue; }
    const first=serial[0] || members[0];
    const seriesTitle=baseOverrides.get(first.id)||baseTitle(first.sourceTitle||first.title), seriesId=first.id;
    const anchor=members.reduce((max,x)=>x.addedAt>max?x.addedAt:max,'');
    let lastOrdinal=0;
    for (const [index,entry] of members.entries()) {
      const sourceTitle=entry.sourceTitle||entry.title;
      let title=sourceTitle;
      if (serial.length > 1 && serial.some(x=>x.id===entry.id)) {
        const explicit=sourceTitle.match(/第([一二三四五六七八九十\d]+)[季期]/);
        const split=/第[2-9２-９二三四五六七八九][部分クール]|第[2-9２-９二三四五六七八九]部分|后半|後半|Part[.\s]*[2-9]/i.test(sourceTitle);
        const ordinal=numberedParts.get(entry.id)||(split?lastOrdinal||1:explicit&&number(explicit[1])>lastOrdinal?number(explicit[1]):lastOrdinal+1);
        lastOrdinal=ordinal;
        if (ordinal) {
          let suffix=sourceTitle.startsWith(seriesTitle)?sourceTitle.slice(seriesTitle.length):stripBase(sourceTitle,seriesTitle)??sourceTitle;
          suffix=suffix.replace(/^\s*第[一二三四五六七八九十\d]+[季期]/,'').replace(/^[\s·:：-]+/,'');
          if(sourceTitle===first.title||sourceTitle===first.sourceTitle)suffix=sourceTitle===seriesTitle?'':suffix;
          if(suffix===sourceTitle){
            let shared=0;while(shared<Math.min(sourceTitle.length,seriesTitle.length)&&sourceTitle[shared]===seriesTitle[shared])shared++;
            if(!(details.get(entry.id)?.name_cn))suffix='';
            else if(shared>=4)suffix=sourceTitle.slice(shared).replace(/^\s*第[一二三四五六七八九十\d]+[季期]/,'').trim();
          }
          suffix=suffix.replace(/^\s*第[一二三四五六七八九十\d]+[季期]/,'').replace(/^[\s·:：!！。．.,，?？~～-]+/,'');
          if(/^[\dⅠⅡⅢⅣⅤⅥⅦⅧⅨⅩIVX]+[！!。.]?$/i.test(suffix))suffix='';
          title=`${seriesTitle} 第${chinese(ordinal)}季${suffix?' · '+suffix:''}`;
          if(entry.id===403225)title=`${seriesTitle} 第二季 · 第2部分`;
          if(entry.id===658054)title=`${seriesTitle} · 第二部`;
          if(sourceTitle.includes('默示录的四骑士'))title=`七大罪 默示录的四骑士 第${chinese(explicit?number(explicit[1]):1)}季`;
        } else if (!sourceTitle.startsWith(seriesTitle)) title=`${seriesTitle} · ${sourceTitle}`;
      }
      result.push({...entry,title,sourceTitle,seriesId,seriesTitle,seriesOrder:index+1,addedAt:anchor});
    }
  }
  return result;
}

export function sortByAdded(entries, direction='desc') {
  const anchors=new Map();
  for(const entry of entries){const key=entry.seriesId||entry.id;anchors.set(key,Math.max(anchors.get(key)||0,Date.parse(entry.addedAt)||0));}
  return entries.sort((a,b)=>{
    const left=a.seriesId||a.id,right=b.seriesId||b.id;
    if(left===right)return (a.seriesOrder||1)-(b.seriesOrder||1)||a.id-b.id;
    const comparison=anchors.get(left)-anchors.get(right);
    return (direction==='asc'?comparison:-comparison)||left-right;
  });
}
