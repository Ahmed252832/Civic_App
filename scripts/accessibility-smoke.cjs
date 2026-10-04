const assert = require('node:assert/strict');
const { chromium } = require('playwright-core');
const { createWebServer } = require('../server/web.cjs');

async function checkControls(page, context) {
  const unnamed = await page.evaluate(() => [...document.querySelectorAll('button,input,select,textarea,a')]
    .filter(element => {
      const box = element.getBoundingClientRect();
      if (!box.width || !box.height || getComputedStyle(element).visibility === 'hidden') return false;
      if (element.getAttribute('aria-label') || element.getAttribute('aria-labelledby') || element.getAttribute('title')) return false;
      if ('labels' in element && element.labels?.length) return false;
      if (['BUTTON', 'A'].includes(element.tagName) && element.textContent?.trim()) return false;
      return true;
    }).map(element => element.outerHTML.slice(0, 160)));
  assert.deepEqual(unnamed, [], `${context} has unnamed controls`);
}

(async () => {
  const { server, database } = await createWebServer({ databasePath: ':memory:', setupKey: 'test-only-key' });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ executablePath: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', headless: true });
  try {
    database.bootstrapAdmin({ name: 'Test Owner', email: 'owner@example.test', password: 'owner-password-123' });
    database.register({ name: 'Test Citizen', email: 'citizen@example.test', area: 'DNCC Ward 15', password: 'citizen-password-123' });
    const origin = `http://127.0.0.1:${server.address().port}`;
    for (const [role, email, password] of [
      ['citizen', 'citizen@example.test', 'citizen-password-123'],
      ['owner', 'owner@example.test', 'owner-password-123']
    ]) {
      const page = await browser.newPage({ viewport: { width: 1100, height: 800 } });
      await page.goto(origin);
      await checkControls(page, `${role} sign-in`);
      await page.getByLabel('Email address').fill(email);
      await page.getByLabel('Password').fill(password);
      await page.getByRole('button', { name: 'Sign in' }).click();
      await page.getByRole('main').waitFor();
      const skip = page.getByRole('link', { name: 'Skip to main content' });
      await page.keyboard.press('Tab');
      assert.equal(await skip.evaluate(element => element === document.activeElement), true);
      await page.keyboard.press('Enter');
      assert.equal(await page.evaluate(() => document.activeElement?.id), 'main-content');
      for (const language of ['en', 'bn']) {
        if (language === 'bn') {
          await page.locator('.language-toggle').getByRole('button', { name: 'বাংলা' }).click();
          assert.equal(await page.locator('html').getAttribute('lang'), 'bn');
        }
        const nav = page.locator('.sidebar nav button');
        for (let index = 0, count = await nav.count(); index < count; index++) {
          await nav.nth(index).click();
          await page.waitForTimeout(80);
          await checkControls(page, `${role} ${language} page ${index}`);
        }
        if (role === 'citizen') {
          await page.locator('.sidebar nav').getByRole('button', { name: language === 'bn' ? 'সমস্যা জানান' : 'Report an issue' }).click();
          await page.getByLabel(language === 'bn' ? 'সমস্যার শিরোনাম' : 'Issue title').fill('Damaged crossing near school');
          await page.getByLabel(language === 'bn' ? 'বিবরণ' : 'Description').fill('The crossing needs repair before more people are hurt.');
          await page.getByLabel(language === 'bn' ? 'ধরন' : 'Category').selectOption('1');
          await page.getByRole('button', { name: language === 'bn' ? 'পরের ধাপ' : 'Continue' }).click();
          await checkControls(page, role + ' ' + language + ' location');
          const checkbox = page.getByRole('checkbox', { name: language === 'bn' ? 'আমি অভিযোগের স্থান ও এই ওয়ার্ড মিলিয়ে দেখেছি।' : 'I checked the issue location and confirm this ward.' });
          await checkbox.focus();
          await page.keyboard.press('Space');
          assert.equal(await checkbox.isChecked(), true);
          await page.keyboard.press('Space');
          assert.equal(await checkbox.isChecked(), false);
          await page.getByLabel(language === 'bn' ? 'সঠিক স্থান বা কাছের পরিচিত স্থানের নাম' : 'Exact place name or nearby landmark').fill('Near the school gate');
          await page.getByLabel(language === 'bn' ? 'অক্ষাংশ' : 'Latitude').fill('23.7469');
          await page.getByLabel(language === 'bn' ? 'দ্রাঘিমাংশ' : 'Longitude').fill('90.3754');
          await checkbox.check();
          await page.getByRole('button', { name: language === 'bn' ? 'পরের ধাপ' : 'Continue' }).click();
          await checkControls(page, role + ' ' + language + ' photo');
          await page.getByRole('button', { name: language === 'bn' ? 'পরের ধাপ' : 'Continue' }).click();
          await checkControls(page, role + ' ' + language + ' review');
          assert.equal(await page.locator('.report-steps [aria-current=step]').count(), 1, 'Review step remains open until the citizen submits');
          assert.equal(await page.locator('.drawer-backdrop').count(), 0, 'Continuing from the photo step must not submit');
        }
      }
      await page.close();
    }
    console.log('Accessibility smoke passed: named controls, skip link, Bangla labels, and keyboard checkbox across citizen and owner screens.');
  } finally {
    await browser.close();
    await new Promise(resolve => server.close(resolve));
    database.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
