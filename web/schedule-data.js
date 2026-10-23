// Trade event calendar data. All times are Korea Standard Time (KST, UTC+9).
//
// 대유행 (pandemic) events follow a fixed cycle: counting whole hours from EPOCH, an event fires in a region
// when (region base + hour index) is divisible by the event's period. The constants match the community
// calendars (uwo-tips, 대항오 나침반); if a game patch shifts the cycle, only these numbers need updating.
// Verified 2026-10-24: all 15 대유행 entries of that day's community trade guide are reproduced.
export const EPOCH = '2026-02-25T00:00:00+09:00';
export const EVENTS = [
  {name: '축제', period: 179, categories: ['식료품', '조미료', '기호품']},
  {name: '전염병', period: 199, categories: ['잡화', '의약품', '섬유']},
  {name: '홍수', period: 223, categories: ['식료품', '공업품', '직물']},
  {name: '전쟁', period: 241, categories: ['가축', '무기류', '총포류']},
  {name: '후원', period: 269, categories: ['염료', '공예품', '미술품']},
  {name: '개발', period: 311, categories: ['공업품', '광석', '주류(또는 식료품)']},
  {name: '호황', period: 337, categories: ['귀금속', '미술품', '보석']},
  {name: '사치', period: 379, categories: ['공예품', '향신료', '향료']},
];
// Region bases step down by 401 in the order the game lists the regions.
export const REGIONS = ['북해', '동지중해', '서지중해 및 대서양', '아프리카 서부', '아프리카 남부', '아프리카 동부',
  '아라비아 및 서인도', '동인도 및 인도차이나', '남아시아', '동아시아', '극동아시아', '오세아니아', '오세아니아 동부',
  '북극해', '남아메리카', '아메리카 동부', '북아메리카 서부', '태평양'].map((name, i) => ({name, base: 28071 - 401 * i}));

// The in-game month advances by one every real day at 09:00 KST; 2026-01-17 (from 09:00) was month 11.
export const CALENDAR = {referenceDay: '2026-01-17', referenceMonth: 11, changeHour: 9};

// Season of each in-game month per climate zone. A city's climate decides which column applies to it.
export const CLIMATES = [
  {id: 'northern', name: '북반구', months: ['겨울', '겨울', '봄', '봄', '봄', '여름', '여름', '여름', '가을', '가을', '가을', '겨울']},
  {id: 'southern', name: '남반구', months: ['여름', '여름', '가을', '가을', '가을', '겨울', '겨울', '겨울', '봄', '봄', '봄', '여름']},
  {id: 'tropicalNorthern', name: '열대 북부', months: ['건기', '건기', '건기', '건기', '건기', '우기', '우기', '우기', '우기', '우기', '건기', '건기']},
  {id: 'tropicalNorthernType2', name: '열대 북부 2', months: ['건기', '건기', '건기', '건기', '우기', '우기', '우기', '우기', '우기', '우기', '건기', '건기']},
  {id: 'tropicalSouthern', name: '열대 남부', months: ['우기', '우기', '우기', '우기', '우기', '건기', '건기', '건기', '건기', '건기', '우기', '우기']},
];
// Peak (+1) and off (-1) seasons per category; categories not listed have no season. Checked against the
// per-item marks of 1,709 city listings, which agree for every category (e.g. 조미료 peaks in summer).
export const CATEGORY_SEASONS = {
  식료품: {봄: -1, 가을: 1, 건기: 1}, 조미료: {여름: 1, 겨울: -1, 건기: 1}, 가축: {여름: -1, 겨울: 1, 건기: 1},
  의약품: {봄: 1, 가을: -1, 우기: 1}, 주류: {여름: -1, 겨울: 1, 건기: 1, 우기: -1}, 염료: {여름: 1, 겨울: -1, 건기: -1, 우기: 1},
  광석: {봄: 1, 가을: -1, 건기: 1, 우기: -1}, 기호품: {봄: -1, 가을: 1, 건기: 1, 우기: -1}, 섬유: {여름: -1, 겨울: 1, 우기: 1},
  직물: {봄: 1, 가을: -1, 건기: 1, 우기: -1}, 향신료: {봄: 1, 가을: -1, 건기: 1, 우기: -1}, 귀금속: {여름: -1, 겨울: 1, 건기: 1, 우기: -1},
  향료: {봄: -1, 가을: 1, 건기: -1, 우기: 1}, 보석: {여름: 1, 겨울: -1, 건기: -1, 우기: 1},
};

// Trade goods that market events reward (the 20 categories a 부양 can target).
export const CATEGORIES = ['식료품', '조미료', '주류', '가축', '기호품', '의약품', '잡화', '섬유', '직물', '염료', '공예품',
  '미술품', '향료', '향신료', '보석', '귀금속', '광석', '공업품', '무기류', '총포류'];

// Recommended goods to sell. 대유행: per event, '*' applies to every region and a region entry replaces it.
// 부양: per category. `where` is where to obtain the good, when known. Seeded from the 2026-10-24 trade guide.
export const RECOMMEND = {
  pandemic: {
    전염병: {
      '*': [{name: '골든씰'}, {name: '구슬인형'}],
      극동아시아: [{name: '골든씰'}, {name: '구슬인형'}, {name: '모링가 열매', where: '오호츠크, 코르프'}],
      북극해: [{name: '버마서적', note: '단가표 참고'}, {name: '모링가 열매', where: '카탄가, 체르스키'}],
      남아메리카: [{name: '귀룽나무'}, {name: '파이프'}],
      '아메리카 동부': [{name: '버마서적'}, {name: '역사서', where: '베라크루스, 메리다'}],
      '북아메리카 서부': [{name: '구슬인형'}],
    },
    축제: {
      동아시아: [{name: '훈제 사프란', where: '마카오, 천주'}, {name: '나일농어'}, {name: '로즈메더'}, {name: '아줄마야'}],
      '아프리카 동부': [{name: '카마스'}, {name: '스트로가니나'}],
      동지중해: [{name: '사고'}, {name: '카마스'}],
    },
    후원: {
      '*': [{name: '북지중해 명산 미술품'}],
      '오세아니아 동부': [{name: '네베스로이드'}, {name: '북지중해 명산 미술품'}],
      극동아시아: [{name: '과라나', where: '조선 영지'}, {name: '북지중해 명산 미술품'}],
      남아시아: [{name: '북지중해 명산 미술품'}, {name: '차이단륵'}],
    },
    호황: {
      남아시아: [{name: '북지중해 명산 미술품'}, {name: '차이단륵'}],
    },
  },
  boost: {
    미술품: [{name: '목피화'}],
    귀금속: [{name: '은괴'}],
    직물: [{name: '비쿠냐 직물'}],
    조미료: [{name: '훈제 사프란'}],
  },
};
