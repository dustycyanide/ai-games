/** DOM overlay: flavour card, perk caps, vend button, toast and screen flash. */

import { FLAVORS, type Flavor, type PerkId } from './flavors';
import { capBadge } from './textures';

export interface HudHandlers {
  onSelect: (index: number) => void;
  onVend: () => void;
  /** Toggle sound; returns the new muted state. */
  onMute: () => boolean;
  onReset: () => void;
}

function el<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`missing #${id}`);
  return node as T;
}

export class Hud {
  private readonly caps: HTMLButtonElement[] = [];
  private readonly vend = el<HTMLButtonElement>('vend');
  private readonly name = el('flavor-name');
  private readonly sub = el('flavor-sub');
  private readonly tag = el('flavor-tag');
  private readonly perk = el('perk-line');
  private readonly toastEl = el('toast');
  private readonly flashEl = el('flash');
  private toastTimer = 0;

  constructor(h: HudHandlers) {
    const row = el('caps');
    FLAVORS.forEach((f, i) => {
      const b = document.createElement('button');
      b.className = 'cap';
      b.type = 'button';
      b.title = `${f.name1} ${f.name2} (${i + 1})`;
      b.setAttribute('aria-label', `${f.name1} ${f.name2}`);
      b.style.setProperty('--glow', f.glow);
      b.style.backgroundImage = `url(${capBadge(f)})`;
      b.addEventListener('click', () => h.onSelect(i));
      row.appendChild(b);
      this.caps.push(b);
    });
    this.vend.addEventListener('click', () => h.onVend());
    const mute = el<HTMLButtonElement>('mute');
    mute.addEventListener('click', () => {
      const muted = h.onMute();
      mute.textContent = muted ? 'Sound off' : 'Sound on';
      mute.setAttribute('aria-pressed', String(muted));
    });
    el('reset').addEventListener('click', () => h.onReset());
    document.body.classList.add('ready');
  }

  setFlavor(f: Flavor, owned: ReadonlySet<PerkId>): void {
    document.documentElement.style.setProperty('--glow', f.glow);
    document.documentElement.style.setProperty('--paint', f.paint);
    this.name.textContent = f.name1;
    this.sub.textContent = f.name2;
    this.tag.textContent = `“${f.tagline}.”`;
    this.setOwned(owned, f);
  }

  setOwned(owned: ReadonlySet<PerkId>, current: Flavor): void {
    this.caps.forEach((b, i) => {
      const f = FLAVORS[i]!;
      b.classList.toggle('owned', owned.has(f.perk));
      b.classList.toggle('selected', f.id === current.id);
    });
    const has = owned.has(current.perk);
    this.perk.innerHTML = '';
    const label = document.createElement('b');
    label.textContent = `${has ? 'Perk active' : 'Perk'}: ${current.perkName}`;
    this.perk.append(label, ` — ${current.perkBlurb}`);
    this.perk.classList.toggle('has', has);
    document.body.classList.toggle('grit', owned.has('grit'));
  }

  setBusy(busy: boolean): void {
    this.vend.disabled = busy;
  }

  toast(title: string, body: string, color: string): void {
    this.toastEl.innerHTML = '';
    const t = document.createElement('strong');
    t.textContent = title;
    t.style.color = color;
    const b = document.createElement('span');
    b.textContent = body;
    this.toastEl.append(t, b);
    this.toastEl.classList.add('show');
    window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => this.toastEl.classList.remove('show'), 3600);
  }

  flash(color: string): void {
    this.flashEl.style.setProperty('--flash', color);
    this.flashEl.classList.remove('go');
    // Force a reflow so the animation restarts.
    void this.flashEl.offsetWidth;
    this.flashEl.classList.add('go');
  }
}
