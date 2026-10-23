import test from 'node:test';
import assert from 'node:assert/strict';
import {pandemicEvents, gameMonth, nextMonthChange, parseBoosts, kstTime, kstDayStart, kstClock, kstDate, climateSeasons, seasonEffect, DAY, HOUR} from '../web/schedule-core.js';
import {CATEGORY_SEASONS, CATEGORIES} from '../web/schedule-data.js';

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

test('부양 lines are parsed from the guide format and other common forms', () => {
  const text = '*11시 메리다 미술품 부양 - 목피화\n*17시 보르도 귀금속 부양\n17:30 브레멘 향신료 관세 1%\n2026-10-25 09:09 산티아고 미술품\n*00시 제노바 직물 부양\n오늘 날씨 좋음\n10시 리스본 과자 부양';
  const {boosts, rejected} = parseBoosts(text, '2026-10-24', {rollover: 6});
  assert.deepEqual(boosts.map(b => [kstDate(b.start), kstClock(b.start), b.city, b.category]), [
    ['2026-10-24', '11:00', '메리다', '미술품'], ['2026-10-24', '17:00', '보르도', '귀금속'], ['2026-10-24', '17:30', '브레멘', '향신료'],
    ['2026-10-25', '09:09', '산티아고', '미술품'], ['2026-10-25', '00:00', '제노바', '직물']]);
  assert.equal(boosts[2].tariff, 1);
  assert.deepEqual(boosts[0].goods.map(g => g.name), ['목피화']);
  assert.deepEqual(rejected, ['오늘 날씨 좋음', '10시 리스본 과자 부양']);
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
