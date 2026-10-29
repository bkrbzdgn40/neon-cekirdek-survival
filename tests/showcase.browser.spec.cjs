const { test, expect } = require('@playwright/test');

// M5.27: The public first-impression surface must be functional, not mock art.
test('M5.27 showcase presents a real game route, accurate public evidence and bilingual navigation',async({page})=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('/showcase.html',{waitUntil:'domcontentloaded'});
  await expect(page).toHaveTitle(/NEON ÇEKİRDEK/);
  await expect(page.locator('html')).toHaveAttribute('lang','en');
  await expect(page.locator('a.btn-primary[href="./index.html"]').first()).toBeVisible();
  await expect(page.locator('a[href="./docs/PRESSKIT.md"]')).toHaveCount(1);
  await expect(page.locator('img[src="./media/neon-core-cover.svg"]')).toBeVisible();
  await expect(page.locator('#gamePreviewFrame')).toHaveCount(0);
  await expect(page.locator('#previewStatus')).toContainText('no game loop');
  await page.locator('#langSwitch').click();
  await expect(page.locator('html')).toHaveAttribute('lang','tr');
  await expect(page.locator('h2 .tr').first()).toBeVisible();
  await expect(page.locator('#previewStatus')).toContainText('oyun döngüsü');
  await expect(page.locator('#langSwitch')).toHaveText('EN');
  await page.locator('#langSwitch').click();
  await expect(page.locator('html')).toHaveAttribute('lang','en');
  expect(errors).toEqual([]);
});

test('M5.27 embedded preview runs the actual game only on request and unloads it completely',async({page})=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('/showcase.html',{waitUntil:'domcontentloaded'});
  await expect(page.locator('#gamePreviewFrame')).toHaveCount(0);
  await page.locator('#loadPreviewBtn').click();
  const frame=page.frameLocator('#gamePreviewFrame');
  await expect(frame.locator('#gameCanvas')).toBeAttached();
  await expect(frame.locator('#startBtn')).toBeAttached();
  await expect.poll(()=>page.evaluate(()=>{
    const f=document.getElementById('gamePreviewFrame');
    return !!f&&f.getAttribute('src')==='./index.html'&&
      f.contentDocument?.getElementById('gameCanvas')?.width>0;
  })).toBe(true);
  await expect(page.locator('#previewStatus')).toContainText('Real game loaded');
  await expect(page.locator('#stopPreviewBtn')).toBeVisible();
  await page.locator('#stopPreviewBtn').click();
  await expect(page.locator('#gamePreviewFrame')).toHaveCount(0);
  await expect(page.locator('#loadPreviewBtn')).toBeVisible();
  await expect(page.locator('#previewStatus')).toContainText('no game loop');
  expect(errors).toEqual([]);
});

test('M5.27 landing is readable and has no horizontal overflow from 320px to desktop',async({page})=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('/showcase.html',{waitUntil:'domcontentloaded'});
  for(const [width,height] of [[320,640],[390,844],[768,1000],[1024,768],[1440,900]]){
    await page.setViewportSize({width,height});
    const r=await page.evaluate(()=>{
      const box=el=>{const b=el.getBoundingClientRect();
        return {left:b.left,right:b.right,width:b.width,height:b.height};};
      const hero=box(document.querySelector('.hero'));
      const image=box(document.querySelector('.art-frame'));
      const game=box(document.querySelector('.hero-actions a[href="./index.html"]'));
      const press=box(document.querySelector('#press'));
      const navigation=box(document.querySelector('.nav-inner'));
      return {overflow:document.documentElement.scrollWidth-innerWidth,
        hero,image,game,press,navigation,bodyOverflow:document.body.scrollWidth-innerWidth};
    });
    expect(r.overflow,'root overflow '+width).toBeLessThanOrEqual(2);
    expect(r.bodyOverflow,'body overflow '+width).toBeLessThanOrEqual(2);
    for(const [name,b] of Object.entries({hero:r.hero,image:r.image,game:r.game,nav:r.navigation})){
      expect(b.left,name+' left '+width).toBeGreaterThanOrEqual(-2);
      expect(b.right,name+' right '+width).toBeLessThanOrEqual(width+2);
      expect(b.width,name+' width '+width).toBeGreaterThan(0);
    }
    expect(r.game.height).toBeGreaterThanOrEqual(43);
  }
  expect(errors).toEqual([]);
});

test('M5.27 real game menu offers a non-disruptive showcase link',async({page})=>{
  await page.goto('/index.html',{waitUntil:'domcontentloaded'});
  const link=page.locator('#showcaseLink');
  await expect(link).toBeVisible();
  await expect(link).toHaveAttribute('href','./showcase.html');
  await expect(link).toHaveAttribute('target','_blank');
  await expect(page.locator('#startBtn')).toBeVisible();
  await page.locator('#startBtn').click();
  await expect(page.locator('#startModal')).toBeHidden();
});

test('M5.27 reduced motion retains all information without continuous page animations',async({page})=>{
  await page.emulateMedia({reducedMotion:'reduce'});
  await page.goto('/showcase.html?lang=tr',{waitUntil:'domcontentloaded'});
  await expect(page.locator('html')).toHaveAttribute('lang','tr');
  const r=await page.evaluate(()=>{
    const doc=getComputedStyle(document.documentElement);
    const btn=getComputedStyle(document.querySelector('.btn-primary'));
    return {scroll:doc.scrollBehavior,transition:btn.transitionDuration,
      frameCount:document.querySelectorAll('iframe').length};
  });
  expect(r.scroll).toBe('auto');
  expect(r.transition).toBe('0s');
  expect(r.frameCount).toBe(0);
});
