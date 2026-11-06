"""Headless browser smoke test of dist/floor-plan-editor.html (needs: pip install playwright; playwright install chromium)."""
import asyncio, pathlib
from playwright.async_api import async_playwright
PAGE = (pathlib.Path(__file__).parent.parent / 'dist' / 'floor-plan-editor.html').resolve().as_uri()
OUT = pathlib.Path(__file__).parent / 'screenshots'
STORED = "JSON.parse(localStorage.getItem('floor-plan-editor.plan'))"

async def main():
    OUT.mkdir(exist_ok=True)
    fails = []
    def check(cond, msg):
        print(('ok   ' if cond else 'FAIL ') + msg)
        if not cond: fails.append(msg)
    async with async_playwright() as p:
        b = await p.chromium.launch()
        pg = await b.new_page(viewport={'width': 1600, 'height': 900})
        errs = []
        pg.on('pageerror', lambda e: errs.append(str(e)))
        await pg.goto(PAGE); await pg.wait_for_timeout(300)
        await pg.screenshot(path=str(OUT / 'initial.png'))

        # Legal wall move previews with highlights and enables Apply
        await pg.click('rect[data-k="seg:D:a|D:e"]')
        await pg.fill('#f-pos', '420'); await pg.dispatch_event('#f-pos', 'input')
        check(not await pg.is_disabled('#apply'), 'moving line D is allowed')
        check('6 parts' in await pg.inner_text('#impact'), 'moving line D highlights 6 parts')
        await pg.click('#cancel')

        # Illegal wall move is blocked
        await pg.click('rect[data-k="seg:E:e|E:g"]')
        await pg.fill('#f-pos', '620'); await pg.dispatch_event('#f-pos', 'input')
        check(await pg.is_disabled('#apply'), 'moving line E past its doors is blocked')
        await pg.keyboard.press('Escape'); await pg.keyboard.press('Escape')

        # Drag + snap + undo
        box = await pg.locator('g[data-k="obj:ensuite-wc"] rect.body').bounding_box()
        x, y = box['x'] + box['width'] / 2, box['y'] + box['height'] / 2
        await pg.mouse.move(x, y); await pg.mouse.down(); await pg.mouse.move(x + 6, y, steps=3); await pg.mouse.up()
        o = await pg.evaluate(STORED + ".objects.find(o => o.id === 'ensuite-wc')")
        check(o['dx'] == 360, f"ensuite WC snaps to a 40 mm gap (dx {o['dx']})")
        await pg.keyboard.press('Control+z')
        o = await pg.evaluate(STORED + ".objects.find(o => o.id === 'ensuite-wc')")
        check(o['dx'] == 370, 'undo restores the WC')

        # Door edit measured from the right end
        await pg.click('g[data-k="op:door-bedroom"] rect.gap')
        await pg.select_option('#f-from', 'b')
        await pg.fill('#f-w', '90'); await pg.dispatch_event('#f-w', 'input')
        await pg.click('#apply')
        d = await pg.evaluate(STORED + ".openings.find(o => o.id === 'door-bedroom')")
        check(d['x'] == [5990, 6890], f"widened door keeps its right end ({d['x']})")

        await pg.screenshot(path=str(OUT / 'after.png'))
        check(not errs, f'no page errors {errs}')
        await b.close()
    print('\n' + (f'{len(fails)} FAILED' if fails else 'all passed'))
    raise SystemExit(1 if fails else 0)

asyncio.run(main())
