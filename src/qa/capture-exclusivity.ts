/** One atomic lease for every asynchronous operator capture in an app instance. */
export function createCaptureGate(){
  let active=false;
  return {
    run<T>(action:()=>T|PromiseLike<T>):Promise<T>{
      if(active)return Promise.reject(new Error('Another operator capture is already in flight'));
      active=true;
      try{return Promise.resolve(action()).finally(()=>{active=false;});}
      catch(error){active=false;return Promise.reject(error);}
    },
  };
}
