import type { OfficialPaper } from '../../domain/officialExam';

const CACHE = 'denko2-official-20260906-v1';
export function paperUrls(paper: OfficialPaper) {
  const files = ['page-11', 'page-15', ...Array.from({length:50},(_,i)=>`q-${i+1}`),
    ...paper.reflow.flatMap(n=>['stem','0','1','2','3'].map(part=>`q-${n}-${part}`))];
  return files.map(f=>`${import.meta.env.BASE_URL}exams/${paper.id}/${f}.webp`);
}
export async function isPaperSaved(paper: OfficialPaper) {
  const cache = await caches.open(CACHE);
  const present = new Set((await cache.keys()).map(r=>r.url));
  return paperUrls(paper).every(url=>present.has(new URL(url,location.origin).href));
}
export async function savePaper(paper: OfficialPaper, progress: (done:number,total:number)=>void) {
  const cache = await caches.open(CACHE), urls=paperUrls(paper);
  let cursor=0, done=0, failure: unknown;
  progress(done,urls.length);
  // Workbox precaching is sequential; six independent requests avoid minutes of startup delay.
  await Promise.all(Array.from({length:6},async()=>{
    while(cursor<urls.length && !failure) {
      const url=urls[cursor++]!;
      try {
        if (!await cache.match(url)) {
          const response=await fetch(url);
          if(!response.ok || !response.headers.get('content-type')?.startsWith('image/')) throw new Error('問題画像を取得できません。');
          await cache.put(url,response);
        }
        progress(++done,urls.length);
      } catch(e) { failure=e; }
    }
  }));
  if(failure) throw failure;
}
