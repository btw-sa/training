"""End-to-end test of the live site, using the local stand-in for Supabase (scripts/dev-server.js).

First-run setup with the setup code, a staff account, a course whose section has product-card PDFs
uploaded in bulk, the in-app card viewer, the quiz that opens after the last card, and checks that
the browser never receives password hashes or correct answers.

Usage: npm run build && python3 web/test/live_e2e.py <card-pdf-dir> <screenshot-dir>
  card-pdf-dir holds a few small PDFs named like "01 - Espresso.pdf".
"""
import json
import os
import subprocess
import sys
import time
import urllib.request
from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
CARDS = sys.argv[1] if len(sys.argv) > 1 else '/tmp/cards'
SHOTS = sys.argv[2] if len(sys.argv) > 2 else '/tmp/shots-live'
PORT = 8790
BASE = f'http://127.0.0.1:{PORT}'
CODE = 'e2e-setup-code-77'
os.makedirs(SHOTS, exist_ok=True)
errors = []
api_bodies = []   # every reply from the server, with who was signed in


def lib(route):
    u = route.request.url
    if '/npm/pdfjs-dist@3.11.174/' in u:
        rel = u.split('/npm/pdfjs-dist@3.11.174/')[1].split('?')[0]
        f = os.path.join(ROOT, 'node_modules', 'pdfjs-dist', rel)
        if os.path.isfile(f):
            return route.fulfill(path=f, content_type='application/javascript' if f.endswith('.js') else 'application/octet-stream', headers={'Access-Control-Allow-Origin': '*'})
        return route.abort()
    m = {'jspdf': 'node_modules/jspdf/dist/jspdf.umd.min.js', 'qrcode': 'node_modules/qrcode-generator/qrcode.js',
         'pdf.worker.min.js': 'node_modules/pdfjs-dist/build/pdf.worker.min.js', 'pdf.min.js': 'node_modules/pdfjs-dist/build/pdf.min.js'}
    for k, v in m.items():
        if k in u:
            return route.fulfill(path=os.path.join(ROOT, v), content_type='application/javascript')
    route.abort()


def new_page(browser, width, height, lang, who):
    ctx = browser.new_context(viewport={'width': width, 'height': height}, accept_downloads=True)
    ctx.add_init_script(f"localStorage.setItem('btw-lang', '{lang}');")
    page = ctx.new_page()
    page.route('https://cdnjs.cloudflare.com/**', lib)
    page.route('https://cdn.jsdelivr.net/**', lib)
    page.route('https://fonts.googleapis.com/**', lambda r: r.abort())
    page.route('https://fonts.gstatic.com/**', lambda r: r.abort())
    page.on('pageerror', lambda e: errors.append(f'pageerror: {e}'))
    page.on('console', lambda m: errors.append(f'console.{m.type}: {m.text}') if m.type == 'error' and 'Failed to load resource' not in m.text and 'net::ERR' not in m.text else None)
    page.on('console', lambda m: errors.append(f'CSP: {m.text}') if 'Content Security Policy' in m.text and 'eval' not in m.text else None)

    def on_resp(r):
        if r.url.endswith('/functions/v1/btw-api'):
            try:
                api_bodies.append((who['name'], r.text()))
            except Exception:
                pass
    page.on('response', on_resp)
    page.goto(BASE + '/')
    page.wait_for_selector('.login-card')
    return ctx, page


def shot(page, name):
    page.screenshot(path=os.path.join(SHOTS, name + '.png'), full_page=False)


def click(page, sel, wait=200):
    page.locator(sel).first.click()
    page.wait_for_timeout(wait)


def wait_js(page, expr, timeout=10000):
    # Polls with page.evaluate (wait_for_function would need eval, which the site's CSP forbids).
    end = time.time() + timeout / 1000
    while time.time() < end:
        if page.evaluate(expr):
            return
        page.wait_for_timeout(100)
    raise TimeoutError('timed out waiting for ' + expr)


def settle(page):
    wait_js(page, "!document.documentElement.hasAttribute('aria-busy')", 15000)
    page.wait_for_timeout(150)


def nav(page, route):
    page.evaluate("r => { const b = document.querySelector(`[data-act=go][data-r=\"${r}\"]`); if (b) b.click(); else throw new Error('no nav ' + r); }", route)
    page.wait_for_timeout(200)


def expect_text(page, text, where=''):
    if text not in page.inner_text('body'):
        errors.append(f'missing text {text!r} {where}')


def run():
    server = subprocess.Popen(['node', os.path.join(ROOT, 'scripts', 'dev-server.js'), '--port', str(PORT), '--setup-code', CODE], stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
    try:
        for _ in range(50):
            try:
                urllib.request.urlopen(BASE + '/config.js', timeout=1)
                break
            except Exception:
                time.sleep(0.1)
        with sync_playwright() as p:
            b = p.chromium.launch()
            who = {'name': 'anon'}

            # ---------- first run: the owner creates the administrator ----------
            ctx, page = new_page(b, 1280, 860, 'en', who)
            page.wait_for_selector('form[data-form=setup]')
            shot(page, '01-setup')
            page.fill('#f-code', 'wrong-code')
            page.fill('#f-nameEn', 'Ibrahim')
            page.fill('#f-nameAr', 'إبراهيم')
            page.fill('#f-email', 'owner@btw.sa')
            page.fill('#f-password', '10203040')
            page.fill('#f-confirm', '10203040')
            click(page, 'form[data-form=setup] button[type=submit]')
            settle(page)
            expect_text(page, 'The setup code is not correct', 'after wrong code')
            page.fill('#f-code', CODE)
            page.fill('#f-password', '10203040')
            page.fill('#f-confirm', '10203040')
            who['name'] = 'admin'
            click(page, 'form[data-form=setup] button[type=submit]')
            settle(page)
            expect_text(page, 'Hello', 'admin home')
            if page.locator('.ribbon').count():
                errors.append('live site shows the trial-copy ribbon')
            shot(page, '02-admin-home')

            # Fewer seconds per card for the test.
            nav(page, 'settings')
            page.fill('input[name=cardMinSeconds]', '1')
            click(page, 'form[data-form=setTraining] button[type=submit]')
            settle(page)

            # ---------- people ----------
            nav(page, 'people')
            click(page, '[data-act=go][data-r=personEdit]')
            page.fill('#f-nameEn', 'Sara Test')
            page.fill('#f-code', 'B-101')
            page.fill('#f-new-password', 'Temp2026x')
            page.fill('#f-new-confirm', 'Temp2026x')
            click(page, 'form[data-form=person] button[type=submit]')
            settle(page)
            expect_text(page, 'Sara Test', 'person created')

            # ---------- course, section, cards ----------
            nav(page, 'courses')
            click(page, '[data-act=newCourse]')
            page.fill('#modal-root input[name=en]', 'Product knowledge')
            page.fill('#modal-root input[name=ar]', 'معرفة المنتجات')
            click(page, '#modal-root button[type=submit]')
            settle(page)
            click(page, '[data-act=addSection]')
            page.fill('#modal-root input[name=en]', 'Hot and cold drinks')
            page.fill('#modal-root input[name=ar]', 'المشروبات الساخنة والباردة')
            click(page, '#modal-root button[type=submit]')
            settle(page)
            pdfs = sorted(os.path.join(CARDS, f) for f in os.listdir(CARDS) if f.endswith('.pdf'))
            page.set_input_files('#card-files', pdfs)
            page.wait_for_selector('#modal-root [data-upload-title]')
            titles = [page.locator('#modal-root [data-upload-title]').nth(i).input_value() for i in range(len(pdfs))]
            expected = [n.split(' - ', 1)[1][:-4] for n in sorted((os.path.basename(f) for f in pdfs), key=lambda n: int(n.split(' - ')[0]))]
            if titles != expected:
                errors.append(f'card titles/order from file names: {titles} (expected {expected})')
            shot(page, '03-upload-modal')
            click(page, '[data-act=doUpload]', 400)
            try:
                page.wait_for_selector('.card-row', timeout=15000)
            except Exception:
                shot(page, 'fail-upload')
                print('TOASTS', page.inner_text('#toasts'), 'ERRS', errors, 'BUSY', page.evaluate('document.documentElement.getAttribute("aria-busy")'))
                raise
            settle(page)
            rows = page.locator('.card-row b').all_inner_texts()
            if rows != titles:
                errors.append(f'cards after upload: {rows}')
            shot(page, '04-section-cards')
            # manager preview of a card
            click(page, '[data-act=previewCard]', 300)
            page.wait_for_selector('#viewer-canvas canvas', timeout=15000)
            shot(page, '05-manager-preview')
            click(page, '.viewer-top [data-act=go]')
            # section quiz
            click(page, '[data-act=go][data-r=examEdit]')
            click(page, '[data-act=exRemoveQ]')
            click(page, '[data-act=exAddQ][data-type=tf]')
            page.fill('#ex-0-pen', 'A flat white uses espresso and steamed milk.')
            click(page, '[data-act=exSave]')
            settle(page)
            # final assessment, publish, assign
            page.evaluate("() => document.querySelector('.back').click()")
            page.wait_for_timeout(200)
            click(page, '[data-act=go][data-r=examEdit]')
            click(page, '[data-act=exRemoveQ]')
            click(page, '[data-act=exAddQ][data-type=tf]')
            page.fill('#ex-0-pen', 'Cold brew is served over ice.')
            click(page, '[data-act=exSave]')
            settle(page)
            click(page, '[data-act=publishCourse]')
            settle(page)
            shot(page, '05b-course-published')
            expect_text(page, 'Published', 'course status after publishing')
            nav(page, 'assign')
            page.select_option('#as-course', label='Product knowledge · v1')
            page.wait_for_timeout(150)
            page.select_option('#as-kind', 'user')
            page.wait_for_timeout(150)
            page.select_option('#as-target', label='Sara Test · Head office')
            click(page, 'form[data-form=assign] button[type=submit]')
            settle(page)
            click(page, '[data-act=openAccount]')
            click(page, '[data-act=signOut]')
            ctx.close()

            # ---------- staff on a phone, Arabic ----------
            who['name'] = 'staff'
            ctx, page = new_page(b, 390, 844, 'ar', who)
            page.fill('#f-identifier', 'b-101')
            page.fill('#f-password', 'Temp2026x')
            click(page, 'form[data-form=login] button[type=submit]')
            settle(page)
            page.wait_for_selector('form[data-form=firstPassword]')
            page.fill('#f-next', 'Mine2026x')
            page.fill('#f-confirm', 'Mine2026x')
            click(page, 'form[data-form=firstPassword] button[type=submit]')
            settle(page)
            shot(page, '06-staff-home-ar')
            click(page, '.hero-continue [data-act=go]')
            settle(page)
            shot(page, '07-section-ar')
            if page.locator('[data-act=startExam]').count():
                errors.append('quiz button visible before the cards')
            click(page, '.cards-head [data-act=openCard]', 300)
            n = len(pdfs)
            for i in range(n):
                page.wait_for_selector('#viewer-canvas canvas', timeout=15000)
                if i == 0:
                    if not page.locator('#viewer-next').is_disabled():
                        errors.append('Next was enabled before the minimum time')
                    shot(page, '08-viewer-ar')
                wait_js(page, "!document.getElementById('viewer-next').disabled", 10000)
                page.wait_for_timeout(150)
                click(page, '#viewer-next', 300)
            page.wait_for_selector('.viewer-done', timeout=10000)
            shot(page, '09-cards-done-ar')
            click(page, '.viewer-done [data-act=startExam]', 400)
            settle(page)
            page.wait_for_selector('fieldset.q')
            page.locator('fieldset.q input[type=radio]').first.check()
            click(page, '[data-act=submitExam]', 300)
            settle(page)
            page.wait_for_selector('.score')
            shot(page, '10-quiz-result-ar')
            ow = page.evaluate('document.documentElement.scrollWidth - document.documentElement.clientWidth')
            if ow > 1:
                errors.append(f'horizontal overflow on phone: {ow}px')
            # session survives reload; then sign out
            page.reload()
            page.wait_for_timeout(800)
            expect_text(page, 'مرحبًا', 'after reload')
            ctx.close()

            # ---------- public certificate check works without signing in ----------
            who['name'] = 'anon'
            ctx, page = new_page(b, 390, 844, 'en', who)
            click(page, '[data-act=go][data-r=verify]')
            page.fill('#f-cert', 'BTW-2026-NOPE-NOPE')
            click(page, 'form[data-form=verify] button[type=submit]')
            settle(page)
            expect_text(page, 'No certificate has this ID', 'verify')
            ctx.close()
            b.close()
    finally:
        server.terminate()
        try:
            out = server.communicate(timeout=3)[0].decode('utf8', 'replace')
            if 'server error' in out:
                errors.append('server logged an error: ' + out[-800:])
        except Exception:
            server.kill()

    # ---------- what reached the browser ----------
    for name, body in api_bodies:
        if '"hash"' in body or '"salt"' in body:
            errors.append(f'password material sent to {name}')
        if name == 'staff' and '"correct"' in body and '"review"' not in body:
            errors.append('correct answers sent to staff outside a quiz review')
        if '10203040' in body or 'Temp2026x' in body or 'Mine2026x' in body:
            errors.append(f'a password appears in a reply to {name}')
    staff_views = [json.loads(bd).get('view') for n, bd in api_bodies if n == 'staff' and '"view"' in bd]
    for v in staff_views:
        if v and any(not u.get('stub') and u.get('code') != 'B-101' for u in v.get('users', [])):
            errors.append('staff copy contains another person\'s full record')


run()
if errors:
    print('FAILURES:')
    for e in errors:
        print(' -', e)
    sys.exit(1)
print('live end-to-end test passed')
