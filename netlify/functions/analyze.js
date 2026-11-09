// Netlify Function: Gemini multimodal analysis. No API key is sent to the browser.
const prompts={
 meal:`Identify only foods actually visible in this meal photo. Give reasonable, approximate TOTAL nutrition estimates for the visible portion. If portions are uncertain, say so. Do not invent ingredients. Respond as a JSON object with fields: title (string), description (string), nutrition (object: carbohydrates_g, protein_g, fiber_g, calories_kcal each number or null), caution (string). No medical advice.`,
 meter:`Read the numeric glucose value displayed on the actual meter if clearly visible. DO NOT GUESS a number if it is blurry, missing or unreadable. Include unit, and do not convert without stating it. Respond as a JSON object with fields: title (string), description (string), reading_mg_dl (number or null; use null if cannot confidently determine mg/dL), caution (string). The patient must confirm before saving.`,
 menu:`Read the visible restaurant menu and compare up to four dishes that actually appear in the image, focusing on factors relevant to carbohydrate consideration. Do not invent dishes or precise nutrition values. Respond as a JSON object with fields title (string), description (string), options (array of objects with name and reason strings), caution (string). No medical advice.`
};
const reply=(status,obj)=>({statusCode:status,headers:{'Content-Type':'application/json','Cache-Control':'no-store','Access-Control-Allow-Origin':'*'},body:JSON.stringify(obj)});
exports.handler=async(event)=>{
 if(event.httpMethod!=='POST') return reply(405,{error:'POST required.'});
 const key=process.env.GEMINI_API_KEY;
 if(!key) return reply(503,{error:'GEMINI_API_KEY is not configured for production Functions.'});
 let payload;try{payload=JSON.parse(event.body||'{}')}catch{return reply(400,{error:'Invalid request.'})}
 const {kind,image}=payload;
 if(!prompts[kind] || typeof image!=='string') return reply(400,{error:'Choose a valid analysis mode and image.'});
 const match=image.match(/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/);
 if(!match) return reply(400,{error:'Unsupported image type. Use JPEG, PNG, or WebP.'});
 if(match[2].length>8_000_000) return reply(413,{error:'Photo is too large; choose a smaller image.'});
 const controller=new AbortController();const timeout=setTimeout(()=>controller.abort(),22000);
 try{
  const model='gemini-3.8-flash';
  const request={contents:[{role:'user',parts:[{text:prompts[kind]},{inline_data:{mime_type:match[1],data:match[2]}}]}],generationConfig:{responseMimeType:'application/json',temperature:0.15,maxOutputTokens:1100}};
  const upstream=await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,{method:'POST',headers:{'x-goog-api-key':key,'Content-Type':'application/json'},body:JSON.stringify(request),signal:controller.signal});
  const result=await upstream.json().catch(()=>({}));
  if(!upstream.ok){const message=result.error?.message||'Google Gemini rejected the request.';return reply(upstream.status===429?429:502,{error:`Gemini API error: ${message.slice(0,250)}`})}
  const raw=(result.candidates?.[0]?.content?.parts||[]).map(x=>x.text||'').join('').trim();
  if(!raw) return reply(502,{error:'Gemini returned no analysis.'});
let analysis;
try {
  const cleaned = raw.trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '');
  analysis = JSON.parse(cleaned);
} catch {
  return reply(502, {
    error: 'Gemini response could not be read as JSON. Please retry.'
  });
}
  if(typeof analysis!=='object'||!analysis||Array.isArray(analysis)) return reply(502,{error:'Gemini returned an unexpected result.'});
  return reply(200,{result:analysis,model});
 }catch(err){return reply(502,{error:err.name==='AbortError'?'Gemini timed out. Try again.':'Unable to connect to Gemini. Please try again.'})}
 finally{clearTimeout(timeout)}
};
