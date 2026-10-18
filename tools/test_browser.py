import asyncio, json, tempfile
from playwright.async_api import async_playwright

MOCK = r'''(() => {
  window.__voiceSockets = [];
  window.__autoVoice = true;
  class FakeSocket {
    constructor() {
      this.readyState = 0; this.bufferedAmount = 0; this.sent = [];
      window.__voiceSockets.push(this);
      setTimeout(() => {
        if (this.closed) return;
        this.readyState = 1; this.onopen?.();
        if (window.__autoVoice) this.emit({type:'conversation_initiation_metadata',conversation_initiation_metadata_event:{agent_output_audio_format:'pcm_16000',user_input_audio_format:'pcm_16000'}});
      }, 60);
    }
    emit(e) { this.onmessage?.({data:JSON.stringify(e)}); }
    send(s) { this.sent.push(JSON.parse(s)); }
    close() { this.closed = true; this.readyState = 3; }
  }
  window.WebSocket = FakeSocket;
  window.__micRequests = 0;
  const original = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
  navigator.mediaDevices.getUserMedia = (...args) => { window.__micRequests++; return original(...args); };
})();'''

async def main():
  async with async_playwright() as p:
    browser = await p.chromium.launch(executable_path='/usr/bin/chromium', headless=True, args=['--no-sandbox','--enable-unsafe-swiftshader','--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream'])
    results=[]
    for name,width,height,dpr in [('desktop',1280,900,1),('4k',3840,2160,2),('mobile',412,839,2)]:
      ctx=await browser.new_context(viewport={'width':width,'height':height},device_scale_factor=dpr)
      await ctx.add_init_script("localStorage.setItem('kz_quality','high');")
      await ctx.add_init_script(MOCK)
      page=await ctx.new_page(); errors=[]
      page.on('pageerror',lambda error:errors.append(str(error)))
      await page.goto('http://127.0.0.1:8000',wait_until='domcontentloaded')
      await page.wait_for_function("!document.getElementById('enter-btn').disabled",timeout=90000)
      dims=await page.evaluate("({width:document.querySelector('#stage canvas').width,height:document.querySelector('#stage canvas').height,overflow:document.documentElement.scrollWidth>innerWidth})")
      assert dims['width']*dims['height']<=3840*2160+5000,dims
      assert not dims['overflow'],dims
      await page.locator('#enter-btn').click(); await page.wait_for_timeout(4800)
      await page.locator('#list-toggle').click(); await page.locator('#list .item').first.click()
      await page.wait_for_function("document.getElementById('book-overlay').classList.contains('show')")
      await page.wait_for_timeout(1200)
      await page.screenshot(path=f'{tempfile.gettempdir()}/kz-{name}.png')
      if name=='desktop':
        # Typed questions do not request a microphone or inject a spoken greeting.
        await page.locator('#text-input').fill('Тест сұрақ'); await page.locator('#text-input').press('Enter')
        await page.wait_for_function("window.__voiceSockets.some(s=>s.sent.some(e=>e.type==='user_message'))")
        info=await page.evaluate("({mic:window.__micRequests,messages:__voiceSockets[0].sent})")
        assert info['mic']==0,info
        assert info['messages'][0]['conversation_config_override']['agent']['first_message']=='',info
        await page.evaluate("__voiceSockets[0].emit({type:'agent_response',agent_response_event:{agent_response:'Тест жауап'}})")
        await page.wait_for_function("document.getElementById('chat-log').textContent.includes('Тест жауап')")
        # Real browser fake microphone + AudioWorklet, mocked server only.
        await page.locator('#live-btn').click()
        await page.wait_for_function("__voiceSockets.at(-1).sent.some(e=>e.user_audio_chunk)",timeout=20000)
        packet=await page.evaluate("__voiceSockets.at(-1).sent.find(e=>e.user_audio_chunk).user_audio_chunk.length")
        assert packet==1708,packet
        await page.locator('#live-btn').click()
        assert await page.evaluate('__voiceSockets.at(-1).closed')
        # Close the book during handshake, then send an obsolete metadata event.
        await page.evaluate('window.__autoVoice=false')
        await page.locator('#live-btn').click()
        await page.wait_for_function('__voiceSockets.length>=3')
        await page.locator('#book-close').click()
        await page.wait_for_timeout(200)
        assert await page.evaluate('__voiceSockets.at(-1).closed')
        await page.evaluate("__voiceSockets.at(-1).emit({type:'conversation_initiation_metadata',conversation_initiation_metadata_event:{agent_output_audio_format:'pcm_16000',user_input_audio_format:'pcm_16000'}})")
        await page.wait_for_timeout(200)
        assert not await page.locator('#live-btn').evaluate("e=>e.classList.contains('on')")
      assert not errors,errors
      results.append({'viewport':name,'drawingBuffer':dims,'pageErrors':errors,'voiceTests':'mock server + real browser worklet' if name=='desktop' else 'layout only'})
      await ctx.close()
    print(json.dumps(results,ensure_ascii=False,indent=2)); await browser.close()
asyncio.run(main())
