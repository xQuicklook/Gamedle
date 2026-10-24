/* ───────── Kurze Einführung (beim ersten Start, später über das Menü) ───────── */
function showTips() {
  const touch = matchMedia('(pointer: coarse)').matches;
  const steps = [
    {
      icon: 'layers', title: 'Ranken',
      text: touch
        ? 'Halte ein Spiel kurz gedrückt und ziehe es in eine Stufe. Oder: Spiel antippen, dann die Stufe antippen. Die Spieleliste unten kannst du am Griff größer und kleiner ziehen.'
        : 'Ziehe Spiele aus der Liste rechts in die Stufen. Den Trenner zwischen Liste und Stufen kannst du verschieben, die Kachelgröße oben einstellen.',
    },
    {
      icon: 'plus', title: 'Spiele hinzufügen',
      text: 'Über „+ Spiele hinzufügen“ findest du jedes Spiel per Suche – mit Cover, Jahr und Reihe. Oder tipp einfach einen Titel ins Suchfeld der Liste.',
    },
    {
      icon: 'lock', title: 'Gemeinsam & verdeckt',
      text: 'Lade Freunde mit dem Raum-Code ein. Ihr rankt verdeckt: Wer fertig ist, meldet „Fertig“ – dann deckt der Host auf und es gibt Gruppenergebnis und Statistik.',
    },
  ];
  if (!touch) steps.push({
    icon: 'edit', title: 'Tastatur',
    keys: [['1 – 9', 'Kachel in Stufe 1–9'], ['0 / Entf', 'zurück in die Liste'], ['← → ↑ ↓', 'Kachel verschieben'], ['Enter', 'auswählen / Details'],
      ['Strg + Z', 'Rückgängig'], ['Strg + Umschalt + Z', 'Wiederholen'], ['+ / − / 0', 'Kachelgröße'], ['Esc', 'Auswahl aufheben']],
    text: 'Tipp: Kachel in der Liste anklicken (oder mit Tab hinspringen) und mit den Zahlen durchranken – der Fokus springt automatisch zum nächsten Spiel.',
  });

  let i = 0;
  const body = h('div.tips');
  const back = h('button.btn.ghost', { onclick: () => { i--; draw(); } }, 'Zurück');
  const next = h('button.btn.primary', { onclick: () => { if (i < steps.length - 1) { i++; draw(); } else m.close(); } });
  const draw = () => {
    const st = steps[i];
    body.replaceChildren(
      h('div.tips-ico', icon(st.icon)),
      h('h3', st.title),
      h('p', st.text),
      ...(st.keys ? [h('div.keys', st.keys.map(([k, d]) => [h('kbd', k), h('span', d)]))] : []),
      h('div.tips-dots', steps.map((_, j) => h('i' + (j === i ? '.on' : '')))),
    );
    back.hidden = i === 0;
    next.textContent = i < steps.length - 1 ? 'Weiter' : 'Los geht’s';
  };
  draw();
  const m = openModal({ title: 'So funktioniert Tierly', width: 460, body, foot: [back, next], autofocus: false });
  Store.set('onboarded', true);
}
