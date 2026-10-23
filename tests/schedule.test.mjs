import test from 'node:test';
import assert from 'node:assert/strict';
import {pandemicEvents, gameMonth, nextMonthChange, parseBoosts, kstTime, kstDayStart, kstClock, kstDate, climateSeasons, seasonEffect, DAY, HOUR} from '../web/schedule-core.js';
import {CATEGORY_SEASONS, CATEGORIES, REGION_ALIASES} from '../web/schedule-data.js';

test('대유행 cycle reproduces the 2026-10-24 community guide', () => {
  const day = kstTime('2026-10-24');
  const events = pandemicEvents(day, day + DAY);
  assert.equal(events.length, 21);
  // Every 대유행 line of that day's guide (hour, region, event), with the guide's region nicknames mapped.
  const guide = [[2, '동아시아', '전염병'], [5, '동아시아', '축제'], [5, '극동아시아', '전염병'], [8, '오세아니아', '전염병'],
    [9, '오세아니아 동부', '후원'], [11, '오세아니아 동부', '전염병'], [12, '아프리카 동부', '축제'], [14, '북극해', '전염병'],
    [14, '극동아시아', '후원'], [17, '남아메리카', '전염병'], [19, '동지중해', '축제'], [19, '남아시아', '후원'],
    [20, '아메리카 동부', '전염병'], [20, '남아시아', '호황'], [23, '북아메리카 서부', '전염병']];
  for (const [hour, region, event] of guide) {
    assert.ok(events.some(e => e.start === kstTime('2026-10-24', hour) && e.region === region && e.event === event), `${hour}시 ${region} ${event}`);
  }
  for (const e of events) { assert.equal(e.end - e.start, HOUR); assert.equal(kstClock(e.start).slice(3), '00'); }
  assert.deepEqual(events.find(e => e.region === '북극해' && e.event === '전염병').goods.map(g => g.name), ['버마서적', '모링가 열매']);
  assert.deepEqual(events.find(e => e.region === '동아시아' && e.event === '전염병').goods.map(g => g.name), ['골든씰', '구슬인형']);
});

test('game month advances daily at 09:00 KST', () => {
  assert.equal(gameMonth(kstTime('2026-01-17', 9)), 11);
  assert.equal(gameMonth(kstTime('2026-01-17', 8, 59)), 10);
  assert.equal(gameMonth(kstTime('2026-10-17', 17, 12)), 8); // uwo-tips showed "게임 시간 8월" then
  assert.equal(gameMonth(kstTime('2026-10-24', 0, 58)), 2); // 대항오 나침반 showed 2월 then
  assert.equal(gameMonth(kstTime('2026-10-24', 9)), 3);
  assert.equal(nextMonthChange(kstTime('2026-10-24', 0, 58)), kstTime('2026-10-24', 9));
  assert.equal(nextMonthChange(kstTime('2026-10-24', 9)), kstTime('2026-10-25', 9));
});

test('KST helpers ignore the machine time zone', () => {
  const t = kstTime('2026-10-24', 23, 30);
  assert.equal(kstDate(t), '2026-10-24'); assert.equal(kstClock(t), '23:30');
  assert.equal(kstDayStart(t), kstTime('2026-10-24')); assert.equal(kstDate(t + HOUR), '2026-10-25');
});

test('부양 lines are parsed from typed lines', () => {
  const text = '*11시 메리다 미술품 부양\n*17시 보르도 귀금속 부양\n17:30 브레멘 향신료 관세 1%\n2026-10-25 09:09 산티아고 미술품\n*00시 제노바 직물 부양\n오늘 날씨 좋음\n10시 리스본 과자 부양';
  const {boosts, rejected} = parseBoosts(text, '2026-10-24');
  assert.deepEqual(boosts.map(b => [kstDate(b.start), kstClock(b.start), b.city, b.category]), [
    ['2026-10-24', '11:00', '메리다', '미술품'], ['2026-10-24', '17:00', '보르도', '귀금속'], ['2026-10-24', '17:30', '브레멘', '향신료'],
    ['2026-10-25', '09:09', '산티아고', '미술품'], ['2026-10-25', '00:00', '제노바', '직물']]);
  assert.equal(boosts[2].tariff, 1);
  assert.equal(boosts[0].goods[0].name, '목피화');
  assert.deepEqual(rejected, ['10시 리스본 과자 부양']); // chatter without a time is ignored, an unknown category is reported
  // A typed line already over at `now` is meant for the next day.
  assert.equal(kstDate(parseBoosts('00시 수에즈 파이프 부양', '2026-10-24', {now: kstTime('2026-10-24', 15)}).boosts[0].start), '2026-10-25');
});

test('a pasted community chat yields its 부양 entries and drops names, chatter and 대유행 lines', () => {
  // Speaker names are placeholders; real exports carry nicknames, which the parser discards.
  const chat = [
    '2026년 10월 23일 금요일',
    '[운영진] [오후 6:03] 21시 브레멘 육두구상자 부양',
    '22시 스트라스부르 육두구 상자 부양',
    '00시 오데사 비쿠냐 직물 부양',
    '[운영진] [오후 8:13] 사진',
    '새 회원님이 들어왔습니다.',
    '2026년 10월 24일 토요일',
    '[운영진] [오전 12:04] 특물 - 운철',
    '',
    '02시 동아시아 전염병 - 골든씰,구슬인형',
    '09시 동부 호주 후원 - 네베스로이드,북지중해 명산 미술품',
    '*11시 메리다 미술품 부양 - 목피화',
    '20시 카리브 전염병 - 버마서적,역사서(베라,메리다)',
    '[운영진] [오전 11:27] 15시 아르한겔스크 식료품 부양 - 사고,카마스',
    '17시 몽펠리에 은괴 부양',
    '19시 반다 미술품 부양 - 북지중해 명산 미술품,차이단륵',
    '[운영진] [오후 4:27] 00시 아덴 파이프 부양',
    '[다른 회원] [오후 5:30] 내일부터 인양 경쟁전입니다.',
  ].join('\n');
  const {boosts, rejected, pandemic} = parseBoosts(chat, '2026-01-01');
  assert.deepEqual(boosts.map(b => [kstDate(b.start), kstClock(b.start), b.city, b.category, b.goods[0].name]), [
    ['2026-10-23', '21:00', '브레멘', '향신료', '육두구 상자'], ['2026-10-23', '22:00', '스트라스부르', '향신료', '육두구 상자'],
    ['2026-10-24', '00:00', '오데사', '직물', '비쿠냐 직물'], ['2026-10-24', '11:00', '메리다', '미술품', '목피화'],
    ['2026-10-24', '15:00', '아르한겔스크', '식료품', '사고'], ['2026-10-24', '17:00', '몽펠리에', '귀금속', '은괴'],
    ['2026-10-24', '19:00', '반다', '미술품', '북지중해 명산 미술품'], ['2026-10-25', '00:00', '아덴', '잡화', '파이프']]);
  assert.deepEqual(boosts[6].goods.map(x => x.name), ['북지중해 명산 미술품', '차이단륵']); // the post's own list wins
  assert.equal(pandemic, 3);
  assert.deepEqual(rejected, []);
  assert.ok(!JSON.stringify(boosts).includes('운영진') && !JSON.stringify(boosts).includes('회원'));
});

test('two more guide days (2026-09-03, 09-20) match the computed 대유행 cycle', () => {
  const region = name => REGION_ALIASES[name] || name;
  const days = {
    '2026-09-03': '05 북해 전염병|07 카리브 호황|08 동지중해 전염병|10 태평양 후원|11 북극해 홍수|11 서지중해&대서양 전염병|12 남아메리카 축제|13 동남아시아 홍수|14 서아프리카 전염병|15 카리브 후원|15 서아프리카 홍수|17 남아프리카 전염병|19 극동아시아 축제|20 동아프리카 전염병|23 중동&서인도 전염병',
    '2026-09-20': '01 서지중해&대서양 전염병|04 남아메리카 홍수|04 서아프리카 전염병|05 카리브 축제|06 동아시아 홍수|07 남아프리카 전염병|08 남아프리카 홍수|10 동아프리카 전염병|12 호주 축제|13 중동&서인도 전염병|16 동인도&인도차이나 전염병|17 호주 호황|17 동지중해 개발|18 동부 호주 후원|19 동인도&인도차이나 축제|19 동남아시아 전염병|22 동아시아 전염병|23 극동아시아 후원',
  };
  for (const [day, list] of Object.entries(days)) {
    const events = pandemicEvents(kstTime(day), kstTime(day) + DAY);
    for (const entry of list.split('|')) {
      const [, hour, name, event] = entry.match(/^(\d+) (.+) (\S+)$/);
      assert.ok(events.some(e => e.start === kstTime(day, Number(hour)) && e.region === region(name) && e.event === event), `${day} ${entry}`);
    }
  }
});

test('season tables cover known categories with consistent signs', () => {
  for (const [category, seasons] of Object.entries(CATEGORY_SEASONS)) {
    assert.ok(CATEGORIES.includes(category), category);
    for (const v of Object.values(seasons)) assert.ok(v === 1 || v === -1);
  }
  const march = Object.fromEntries(climateSeasons(3).map(c => [c.id, c.season]));
  assert.deepEqual(march, {northern: '봄', southern: '가을', tropicalNorthern: '건기', tropicalNorthernType2: '건기', tropicalSouthern: '우기'});
  assert.equal(seasonEffect('조미료', '여름'), 1); assert.equal(seasonEffect('조미료', '봄'), 0); assert.equal(seasonEffect('미술품', '봄'), 0);
});
