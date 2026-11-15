# Четыре направления на одних и тех же двух экранах.
PLAN = '''<svg viewBox="0 0 780 760" class="plan">
  <defs>
    <pattern id="hz-{t}" width="24" height="24" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="24" height="24" class="hz-a"/><rect width="12" height="24" class="hz-b"/></pattern>
    <pattern id="tl-{t}" width="65" height="65" patternUnits="userSpaceOnUse"><path d="M65 0H0V65" fill="none" class="tile" stroke-width="2"/></pattern>
    <pattern id="ht-{t}" width="10" height="10" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="10" height="10" fill="none"/><rect width="3" height="10" class="hatch"/></pattern>
    <g id="rk-{t}"><rect width="176" height="30" rx="5"/><g class="box"><rect x="8" y="6" width="26" height="18" rx="2"/><rect x="40" y="6" width="26" height="18" rx="2"/><rect x="72" y="6" width="26" height="18" rx="2"/><rect x="104" y="6" width="26" height="18" rx="2"/><rect x="136" y="6" width="32" height="18" rx="2"/></g></g>
    <g id="vn-{t}"><rect width="74" height="120" rx="12" class="van"/><rect x="9" y="84" width="56" height="26" rx="6" class="glass"/></g>
  </defs>
  <rect width="780" height="760" class="yard"/>
  <rect x="20" y="20" width="740" height="590" rx="18" class="floor"/>
  <rect x="20" y="20" width="740" height="590" rx="18" fill="url(#tl-{t})"/>
  <rect x="44" y="48" width="216" height="252" rx="16" class="z dry"/><g class="r dry"><rect x="64" y="118" width="176" height="30" rx="5"/><g class="box"><rect x="72" y="124" width="26" height="18" rx="2"/><rect x="104" y="124" width="26" height="18" rx="2"/><rect x="136" y="124" width="26" height="18" rx="2"/><rect x="168" y="124" width="26" height="18" rx="2"/><rect x="200" y="124" width="32" height="18" rx="2"/></g><rect x="64" y="162" width="176" height="30" rx="5"/><g class="box"><rect x="72" y="168" width="26" height="18" rx="2"/><rect x="104" y="168" width="26" height="18" rx="2"/><rect x="136" y="168" width="26" height="18" rx="2"/><rect x="168" y="168" width="26" height="18" rx="2"/><rect x="200" y="168" width="32" height="18" rx="2"/></g><rect x="64" y="206" width="176" height="30" rx="5"/><g class="box"><rect x="72" y="212" width="26" height="18" rx="2"/><rect x="104" y="212" width="26" height="18" rx="2"/><rect x="136" y="212" width="26" height="18" rx="2"/><rect x="168" y="212" width="26" height="18" rx="2"/><rect x="200" y="212" width="32" height="18" rx="2"/></g><rect x="64" y="250" width="176" height="30" rx="5"/><g class="box"><rect x="72" y="256" width="26" height="18" rx="2"/><rect x="104" y="256" width="26" height="18" rx="2"/><rect x="136" y="256" width="26" height="18" rx="2"/><rect x="168" y="256" width="26" height="18" rx="2"/><rect x="200" y="256" width="32" height="18" rx="2"/></g></g>
  <rect x="282" y="48" width="216" height="252" rx="16" class="z chilled"/><g class="r chilled"><rect x="302" y="118" width="176" height="30" rx="5"/><g class="box"><rect x="310" y="124" width="26" height="18" rx="2"/><rect x="342" y="124" width="26" height="18" rx="2"/><rect x="374" y="124" width="26" height="18" rx="2"/><rect x="406" y="124" width="26" height="18" rx="2"/><rect x="438" y="124" width="32" height="18" rx="2"/></g><rect x="302" y="162" width="176" height="30" rx="5"/><g class="box"><rect x="310" y="168" width="26" height="18" rx="2"/><rect x="342" y="168" width="26" height="18" rx="2"/><rect x="374" y="168" width="26" height="18" rx="2"/><rect x="406" y="168" width="26" height="18" rx="2"/><rect x="438" y="168" width="32" height="18" rx="2"/></g><rect x="302" y="206" width="176" height="30" rx="5"/><g class="box"><rect x="310" y="212" width="26" height="18" rx="2"/><rect x="342" y="212" width="26" height="18" rx="2"/><rect x="374" y="212" width="26" height="18" rx="2"/><rect x="406" y="212" width="26" height="18" rx="2"/><rect x="438" y="212" width="32" height="18" rx="2"/></g><rect x="302" y="250" width="176" height="30" rx="5"/><g class="box"><rect x="310" y="256" width="26" height="18" rx="2"/><rect x="342" y="256" width="26" height="18" rx="2"/><rect x="374" y="256" width="26" height="18" rx="2"/><rect x="406" y="256" width="26" height="18" rx="2"/><rect x="438" y="256" width="32" height="18" rx="2"/></g></g>
  <rect x="520" y="48" width="216" height="252" rx="16" class="z frozen"/><g class="r frozen"><rect x="540" y="118" width="176" height="30" rx="5"/><g class="box"><rect x="548" y="124" width="26" height="18" rx="2"/><rect x="580" y="124" width="26" height="18" rx="2"/><rect x="612" y="124" width="26" height="18" rx="2"/><rect x="644" y="124" width="26" height="18" rx="2"/><rect x="676" y="124" width="32" height="18" rx="2"/></g><rect x="540" y="162" width="176" height="30" rx="5"/><g class="box"><rect x="548" y="168" width="26" height="18" rx="2"/><rect x="580" y="168" width="26" height="18" rx="2"/><rect x="612" y="168" width="26" height="18" rx="2"/><rect x="644" y="168" width="26" height="18" rx="2"/><rect x="676" y="168" width="32" height="18" rx="2"/></g><rect x="540" y="206" width="176" height="30" rx="5"/><g class="box"><rect x="548" y="212" width="26" height="18" rx="2"/><rect x="580" y="212" width="26" height="18" rx="2"/><rect x="612" y="212" width="26" height="18" rx="2"/><rect x="644" y="212" width="26" height="18" rx="2"/><rect x="676" y="212" width="32" height="18" rx="2"/></g><rect x="540" y="250" width="176" height="30" rx="5"/><g class="box"><rect x="548" y="256" width="26" height="18" rx="2"/><rect x="580" y="256" width="26" height="18" rx="2"/><rect x="612" y="256" width="26" height="18" rx="2"/><rect x="644" y="256" width="26" height="18" rx="2"/><rect x="676" y="256" width="32" height="18" rx="2"/></g></g>
  <g fill="none" class="lane" stroke-width="7" stroke-linecap="round" stroke-dasharray="2 20"><path d="M150 596V345H630V596"/><path d="M390 345V398"/></g>
  <rect x="300" y="398" width="180" height="150" rx="14" class="spot" stroke-width="4" stroke-dasharray="14 10"/>
  <g transform="translate(326 422)"><rect width="128" height="102" rx="6" class="wood"/><g class="carton" stroke-width="3"><rect x="10" y="10" width="50" height="38" rx="4"/><rect x="68" y="10" width="50" height="38" rx="4"/><rect x="10" y="54" width="50" height="38" rx="4"/><rect x="68" y="54" width="50" height="38" rx="4"/></g></g>
  <g class="wall"><rect x="12" y="12" width="756" height="14" rx="7"/><rect x="12" y="12" width="14" height="606" rx="7"/><rect x="754" y="12" width="14" height="606" rx="7"/><rect x="12" y="604" width="46" height="14" rx="7"/><rect x="242" y="604" width="166" height="14"/><rect x="498" y="604" width="24" height="14"/><rect x="612" y="604" width="24" height="14"/><rect x="726" y="604" width="42" height="14" rx="7"/></g>
  <g fill="url(#hz-{t})"><rect x="50" y="596" width="14" height="30" rx="3"/><rect x="236" y="596" width="14" height="30" rx="3"/><rect x="400" y="596" width="14" height="30" rx="3"/><rect x="492" y="596" width="14" height="30" rx="3"/><rect x="514" y="596" width="14" height="30" rx="3"/><rect x="606" y="596" width="14" height="30" rx="3"/><rect x="628" y="596" width="14" height="30" rx="3"/><rect x="720" y="596" width="14" height="30" rx="3"/></g>
  <rect x="86" y="622" width="128" height="150" rx="8" class="van"/>
  <rect x="416" y="626" width="74" height="120" rx="12" class="van"/><rect x="425" y="710" width="56" height="26" rx="6" class="glass"/><rect x="416" y="640" width="74" height="12" class="stripe dry"/><rect x="530" y="626" width="74" height="120" rx="12" class="van"/><rect x="539" y="710" width="56" height="26" rx="6" class="glass"/><rect x="530" y="640" width="74" height="12" class="stripe chilled"/><rect x="644" y="626" width="74" height="120" rx="12" class="van"/><rect x="653" y="710" width="56" height="26" rx="6" class="glass"/><rect x="644" y="640" width="74" height="12" class="stripe frozen"/>
</svg>'''

# «Объём»: тот же план, но у предметов есть высота — передняя грань и тень.
def block(x, y, w, h, cls, depth=30):
    racks = ''.join(f'<g transform="translate({x+18} {y+62+i*44})"><rect width="{w-36}" height="30" rx="7" class="rk {cls}"/><rect y="22" width="{w-36}" height="12" rx="6" class="rkf {cls}"/></g>' for i in range(4))
    return (f'<rect x="{x+6}" y="{y+depth+10}" width="{w}" height="{h}" rx="22" class="sh"/>'
            f'<rect x="{x}" y="{y+depth}" width="{w}" height="{h}" rx="22" class="zf {cls}"/>'
            f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="22" class="zt {cls}"/>{racks}')
def van(x, cls):
    return (f'<rect x="{x+5}" y="646" width="78" height="112" rx="16" class="sh"/><rect x="{x}" y="640" width="78" height="112" rx="16" class="vf"/>'
            f'<rect x="{x}" y="628" width="78" height="112" rx="16" class="vt"/><rect x="{x+10}" y="640" width="58" height="16" rx="8" class="vs {cls}"/><rect x="{x+10}" y="706" width="58" height="24" rx="8" class="vg"/>')
SOFT = f'''<svg viewBox="0 0 780 760" class="soft">
  <rect width="780" height="760" class="yard"/>
  <rect x="16" y="28" width="748" height="596" rx="30" class="edge"/>
  <rect x="16" y="14" width="748" height="596" rx="30" class="floor"/>
  {block(40,36,220,236,'dry')}{block(280,36,220,236,'chilled')}{block(520,36,220,236,'frozen')}
  <g fill="none" class="lane" stroke-width="10" stroke-linecap="round" stroke-dasharray="1 26"><path d="M150 590V352H630V590"/><path d="M390 352V400"/></g>
  <rect x="296" y="402" width="188" height="150" rx="26" class="spot"/>
  <rect x="330" y="446" width="126" height="92" rx="12" class="sh"/><rect x="326" y="436" width="126" height="92" rx="12" class="pf"/><rect x="326" y="424" width="126" height="92" rx="12" class="pt"/>
  <g class="ct"><rect x="338" y="412" width="48" height="40" rx="8"/><rect x="392" y="412" width="48" height="40" rx="8"/><rect x="338" y="458" width="48" height="40" rx="8"/><rect x="392" y="458" width="48" height="40" rx="8"/></g>
  <g class="gate"><rect x="60" y="586" width="180" height="38" rx="10"/><rect x="406" y="586" width="98" height="38" rx="10"/><rect x="520" y="586" width="98" height="38" rx="10"/><rect x="634" y="586" width="98" height="38" rx="10"/></g>
  <rect x="91" y="640" width="128" height="130" rx="14" class="sh"/><rect x="86" y="634" width="128" height="130" rx="14" class="vf"/><rect x="86" y="620" width="128" height="130" rx="14" class="vt"/>
  {van(416,'dry')}{van(530,'chilled')}{van(644,'frozen')}
</svg>'''

THEMES = {
 'a': ('А · Разметка', 'Светлый бетон, чёрный шрифт, жёлтый как на разметке', PLAN),
 'b': ('Б · Ночная смена', 'Тёмный, один сигнальный цвет, план светится', PLAN),
 'c': ('В · Объём', 'Тёплый, мягкий, у предметов есть высота — ближе к игре', SOFT),
 'd': ('Г · Накладная', 'Бумага и штамп: моноширинный шрифт, чёрное с красным', PLAN),
}

def shift(t, svg):
    return f'''<div class="phone" data-t="{t}">
  <div class="top"><div class="brand"><b>Рябиновая</b><span>Смена 3 · Полный кузов</span></div><div class="clock"><b class="num">4:52</b><button class="icon-btn">II</button></div></div>
  <div class="kpis"><div><span class="label">Отгружено</span><b class="num">2 / 19</b></div><div><span class="label">Вовремя</span><b class="num">100%</b></div><div><span class="label">Точность</span><b class="num">100%</b></div></div>
  <div class="scene">{svg.replace('{t}', t)}
    <div class="sign dry" style="left:19.5%;top:11.5%"><b>+18°</b><small>Сухач</small></div>
    <div class="sign chilled" style="left:50%;top:11.5%"><b>+4°</b><small>Охлаждёнка</small></div>
    <div class="sign frozen" style="left:80.5%;top:11.5%"><b>−18°</b><small>Заморозка</small></div>
    <div class="tag" style="left:19.2%;top:76%">Приёмка</div><div class="tag" style="left:72.5%;top:76%">Отгрузка</div>
    <div class="ring" style="left:38%;top:51.8%;width:24%;height:21%"></div>
    <div class="tag y" style="left:50%;top:50.5%">ещё 8 шт.</div>
    <div class="timer" style="left:58.5%;top:88%">уйдёт 0:07</div>
  </div>
  <div class="board"><div class="head"><span class="label">Заявки</span><span class="label">3 из 5 открыты</span></div><div class="rows">
    <div class="row active"><div class="t">Тушино<span class="num">0 / 10</span></div><div class="d"><i class="dot dry"></i>Вода 1,5 л <span class="chip">в работе</span></div></div>
    <div class="row"><div class="t">Беломорская<span class="num">0 / 2</span></div><div class="d"><i class="dot dry"></i>Хлеб</div></div>
    <div class="row"><div class="t">Медведково<span class="num">0 / 5</span></div><div class="d"><i class="dot dry"></i>Хлеб, вода</div></div>
    <div class="row done"><div class="t">Беломорская<span class="num">2 / 2 ✓</span></div><div class="d"><i class="dot chilled"></i>Молоко</div></div>
  </div></div>
  <div class="bar"><button class="ghost">Как играть</button><button class="tsd-btn"><i class="led"></i>ТСД</button><button class="ghost">Завершить</button></div>
</div>'''

def task(t, svg):
    return f'''<div class="phone" data-t="{t}">
  <div class="top"><div class="brand"><b>Рябиновая</b><span>Смена 3 · Полный кузов</span></div><div class="clock"><b class="num">4:57</b><button class="icon-btn">II</button></div></div>
  <div class="kpis"><div><span class="label">Отгружено</span><b class="num">0 / 19</b></div><div><span class="label">Вовремя</span><b class="num">—</b></div><div><span class="label">Точность</span><b class="num">—</b></div></div>
  <div class="scene">{svg.replace('{t}', t + '2')}</div>
  <div class="dim"></div>
  <div class="device"><div class="lcd">
    <span class="label">ТСД · новое задание</span><h2>Собрать паллету</h2>
    <div class="task">Беломорская — молоко, 2 шт.</div><div class="due">Фургон уходит через 0:12</div>
    <button class="primary">Принять</button>
    <dl class="dl"><div><dt>Куда</dt><dd>Беломорская</dd></div><div><dt>Зона хранения</dt><dd>Охлаждёнка +4°</dd></div></dl>
    <div class="queue"><span class="label">Дальше в очереди</span><ol><li>Тушино — вода</li><li>Беломорская — хлеб</li><li>Медведково — хлеб, вода</li></ol></div>
  </div></div>
</div>'''

css = open('variants.css').read()
cols = ''.join(f'<div class="col"><h3>{name}</h3><p>{note}</p>{shift(t, svg)}{task(t, svg)}</div>' for t, (name, note, svg) in THEMES.items())
open('variants.html', 'w').write(f'<!doctype html><html lang="ru"><head><meta charset="utf-8"><style>{css}</style></head><body>{cols}</body></html>')
