import test from 'node:test';
import assert from 'node:assert/strict';
import {initialState,migrateLegacyLocks} from '../web/model.js';
test('legacy position locks become owned required crew without changing placement or equipment',()=>{
  const state=initialState();state.ships[2][4]='legacy';state.locked=['legacy'];state.required=['existing'];state.owned=['existing'];state.configs.legacy={effects:['effect'],transcended:true};
  migrateLegacyLocks(state);
  assert.deepEqual(state.locked,[]);assert.deepEqual(state.required,['existing','legacy']);assert.deepEqual(state.owned,['existing','legacy']);assert.equal(state.ships[2][4],'legacy');assert.deepEqual(state.configs.legacy,{effects:['effect'],transcended:true});
  assert.deepEqual(migrateLegacyLocks(structuredClone(state)),state);
});
