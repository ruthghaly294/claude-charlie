import { expect, it } from "vitest";
import { startChrome } from "../../src/chrome-process.js";
import { scrollFacebookResults } from "../../src/facebook/pagination.js";
it("scrolls the results pane rather than a header or sidebar to load subsequent batches", async () => {
  const session = await startChrome({ headless: true });
  try {
    const p = await session.browser.contexts()[0]!.newPage();
    await p.setContent(
      `<style>body{margin:0;overflow:hidden}header{height:120px}main{height:400px;overflow:auto;width:600px;margin-left:300px}a{display:block;height:100px}</style><header>Header</header><main><div id="items"></div><div style="height:200px"></div></main><script>let count=0,batches=0;function add(){for(let i=0;i<6;i++){const a=document.createElement('a');a.href='https://www.facebook.com/marketplace/item/'+(++count)+'/';a.textContent='Listing '+count;items.append(a);}}add();document.querySelector('main').addEventListener('scroll',e=>{const m=e.target;if(m.scrollHeight-m.scrollTop-m.clientHeight<30&&batches<2){batches++;add();}});</script>`,
    );
    await p.mouse.move(0, 0);
    for (let i = 0; i < 3; i++) {
      await p
        .locator('a[href*="/marketplace/item/"]')
        .last()
        .scrollIntoViewIfNeeded();
      await p.mouse.wheel(0, 1600);
      await p.waitForTimeout(100);
    }
    expect(await p.locator('a[href*="/marketplace/item/"]').count()).toBe(6);
    for (let i = 0; i < 5; i++) {
      await scrollFacebookResults(p);
      await p.waitForTimeout(100);
    }
    expect(await p.locator('a[href*="/marketplace/item/"]').count()).toBe(18);
    await p.close();
  } finally {
    await session.close();
  }
}, 15000);
