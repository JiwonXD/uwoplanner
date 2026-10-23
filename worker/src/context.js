// Builds the grounding text the trade assistant answers from. Pure functions: the Worker and the Node tests
// both import this. The static part (rules + reference tables) is identical for every request so it can be
// prompt-cached; the dynamic part carries the current time and the computed 대유행 schedule.
import {pandemicEvents, gameMonth, kstDate, kstClock, HOUR} from '../../web/schedule-core.js';
import {EVENTS, REGIONS, RECOMMEND, REGION_ALIASES, PANDEMIC_HOURS} from '../../web/schedule-data.js';

// Official multipliers (notices 2025-03-17, 2025-06-20 and 2026-08-07). Normal goods, not 명산품.
const PANDEMIC_RATES = {
  식료품: '345~423%', 의약품: '365~447%', 조미료: '332~406%', 잡화: '297~365%', 가축: '237~291%', 광석: '240~290%',
  주류: '240~280%', 총포류: '245~285%', 향신료: '225~275%', 향료: '225~265%', 직물: '210~258%', 섬유: '200~250%',
  공업품: '191~235%', 기호품: '191~235%', 무기류: '180~220%', 염료: '180~220%', 공예품: '175~215%',
  보석: '165~175%', 미술품: '165~175%', 귀금속: '165~175%',
};
const BOOST_RATES = {
  의약품: '260~270%', 식료품: '240~250%', 조미료: '225~235%', 총포류: '215~225%', 향료: '210~220%', 광석: '205~215%',
  향신료: '205~215%', 주류: '200~210%', 가축: '195~205%', 잡화: '195~205%', 직물: '195~205%', 공업품: '185~195%',
  기호품: '185~195%', 섬유: '180~190%', 염료: '175~185%', 공예품: '175~185%', 무기류: '175~185%',
  미술품: '150~160%', 귀금속: '150~160%', 보석: '150~160%',
};

const goods = list => list.map(g => g.name + (g.where ? ` (${g.where})` : '') + (g.note ? ` [${g.note}]` : '')).join(', ');

export function staticContext() {
  const pandemic = Object.entries(RECOMMEND.pandemic).map(([event, table]) =>
    `- ${event}: ` + Object.entries(table).map(([region, list]) => `${region === '*' ? '기본' : region} = ${goods(list)}`).join(' / ')).join('\n');
  const boost = Object.entries(RECOMMEND.boost).map(([category, list]) => `- ${category}: ${goods(list)}`).join('\n');
  return `너는 대항해시대 오리진의 교역 도우미다. 사용자가 대유행이나 부양 일정, 도시, 권역을 말하면 무엇을 팔면 좋은지 알려 준다.

답변 규칙
- 한국어로, 짧게 답한다. 결론(팔 교역품과 어디서 구할지)을 먼저 말한다.
- 가운뎃점(·)을 쓰지 않는다. 목록이 필요하면 줄을 나눈다.
- 추천 교역품은 아래 추천표에 있는 것만 말한다. 표에 없으면 "추천 자료가 없다"고 말하고, 오르는 카테고리만 알려 준다. 교역품이나 가격을 지어내지 않는다.
- 시세는 아래 공식 배율만 인용한다. 실제 판매가는 재고, 관세, 우대에 따라 다르다는 점을 필요할 때 한 줄로 덧붙인다.
- 시각은 모두 한국 시간(KST)이다. 대유행 일정은 아래 "계산된 대유행 일정"만 사용한다. 그 범위 밖의 날짜를 물으면 범위 밖이라 확인할 수 없다고 말한다.
- 부양은 시장이 여는 행사라 계산할 수 없다. 사용자가 알려 준 부양(도시, 카테고리 또는 교역품, 시각)을 그대로 믿고 답한다.
- 사용자가 도시만 말하면, 그 도시가 속한 권역을 아래 권역 목록에서 판단하고 그 판단을 한 번 밝힌다. 확실하지 않으면 물어본다.
- 교역과 상관없는 질문에는 이 도우미가 교역 이벤트만 다룬다고 짧게 답한다.

시스템 규칙
- 대유행: 권역 단위로 ${PANDEMIC_HOURS}시간 동안 열린다. 서버 전체가 함께 쓰는 예산이 있어 예산이 떨어지면 일찍 끝난다. 끝난 뒤 1시간 동안 추가 매입(카테고리별 고정 시세, 예산 없음)이 있다.
- 부양: 그 도시의 시장이 1주일에 한 번, 1시간 동안 연다. 지정한 카테고리를 비싸게 판다. 원격 예약은 최소 3시간 전에 한다.
- 한 도시에는 시세 이벤트가 하나만 걸리며 시장 행사가 다른 이벤트보다 우선한다.

대유행 종류와 오르는 카테고리
${EVENTS.map(e => `- ${e.name}: ${e.categories.join(', ')}`).join('\n')}

대유행 시세 (일반 품목)
${Object.entries(PANDEMIC_RATES).map(([c, r]) => `${c} ${r}`).join(', ')}

부양 시세
${Object.entries(BOOST_RATES).map(([c, r]) => `${c} ${r}`).join(', ')}

권역 목록: ${REGIONS.map(r => r.name).join(', ')}
권역 별칭: ${Object.entries(REGION_ALIASES).map(([a, r]) => `${a}=${r}`).join(', ')}

대유행 추천표 (이벤트별, "기본"은 따로 적힌 권역이 없을 때)
${pandemic}

부양 추천표 (카테고리별)
${boost}`;
}

// The current time and the 대유행 schedule from two hours ago (ongoing events) through `hoursAhead`.
export function dynamicContext(now, hoursAhead = 36) {
  const events = pandemicEvents(now - PANDEMIC_HOURS * HOUR, now + hoursAhead * HOUR).filter(e => e.end > now);
  const line = e => `${kstDate(e.start).slice(5).replace('-', '/')} ${kstClock(e.start)}~${kstClock(e.end)} ${e.region} ${e.event}${e.start <= now ? ' (진행 중)' : ''}`;
  return `현재 시각: ${kstDate(now)} ${kstClock(now)} KST, 게임 ${gameMonth(now)}월 (매일 09:00에 다음 달로 넘어감)

계산된 대유행 일정 (지금부터 ${hoursAhead}시간)
${events.map(line).join('\n') || '없음'}`;
}
