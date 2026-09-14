import {indexCatalog} from './model.js';
import {solve} from './solver.js';
self.onmessage=event=>{
  try{const {state,catalog}=event.data;
    const result=solve(state,indexCatalog(catalog),{milliseconds:state.budget,onProgress:r=>self.postMessage({type:'progress',...r})});
    self.postMessage({type:'done',...result});
  }catch(error){self.postMessage({type:'error',message:error.message});}
};
