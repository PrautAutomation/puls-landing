import { isPlatformBrowser } from '@angular/common';
import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  AfterViewInit,
  Component,
  OnDestroy,
  OnInit,
  PLATFORM_ID,
  ViewEncapsulation,
  inject,
} from '@angular/core';

interface LandingTier {
  key: string;
  name: string;
  labelCs: string;
  description: string;
  tagline: string;
  takeaways: string[];
}

type LandingLogoState = 'klid' | 'puls' | 'thread' | 'nav';
type LandingThreadState =
  | 'zazeh'
  | 'klid'
  | 'zhusteni'
  | 'flare'
  | 'ping-flash'
  | 'utulek'
  | 'doutnak';

interface ThreadStateConfig {
  density: number;
  stroke: number;
  blur: number;
  violet: number;
  cyan: number;
  gold: number;
  amplitude: [number, number];
  rate: string;
  spread?: number;
}

interface PulsUtulekController {
  activate: () => void;
  deactivate: () => void;
  readonly isActive: boolean;
}

interface PulsWindow extends Window {
  pulsUtulek?: PulsUtulekController;
}

const tierSharedOffer =
  '10 pracovních dní. Živé online hodiny. Krátký vstupní dotazník - žádný test tvých znalostí, jen potřebujeme znát tvůj kontext, abychom příklady trefili do tvé praxe. Všechny materiály a postavená workflow ti zůstanou navždy.';

const logoIntroDelayMs = 600;
const logoPulseDurationMs = 2400;
const logoSessionStorageKey = 'puls-zazeh-played';
const narrativeWordVisibleMs = 1350;
const narrativeWordTransitionMs = 540;
const narrativeWordPauseMs = 210;
const narrativeWordStepMs =
  narrativeWordVisibleMs + narrativeWordTransitionMs + narrativeWordPauseMs;
const narrativeWordSettleDelayMs = 1900;
const localNeedleRevealDelayMs = (5 - 1) * narrativeWordStepMs + narrativeWordSettleDelayMs;
const heroNeedleHandoffDurationMs = 1280;

const threadSectionStateMap: Record<string, LandingThreadState> = {
  hero: 'klid',
  headline: 'klid',
  problem: 'klid',
  'breath-1': 'klid',
  reseni: 'zhusteni',
  prechod: 'flare',
  'breath-2': 'flare',
  selektor: 'flare',
  certifikat: 'klid',
  planner: 'klid',
  nemluvis: 'klid',
  'tereza-quote': 'utulek',
  'breath-3': 'klid',
  garance: 'klid',
  sef: 'klid',
  finale: 'doutnak',
  footer: 'doutnak',
};

const threadStateConfig: Record<LandingThreadState, ThreadStateConfig> = {
  zazeh: {
    density: 14,
    stroke: 2,
    blur: 64,
    violet: 0.9,
    cyan: 0.35,
    gold: 0.04,
    amplitude: [4, 14],
    rate: '2.4s',
  },
  klid: {
    density: 10,
    stroke: 1.5,
    blur: 48,
    violet: 0.42,
    cyan: 0.1,
    gold: 0.018,
    amplitude: [2, 8],
    rate: '6s',
  },
  zhusteni: {
    density: 12,
    stroke: 2.5,
    blur: 56,
    violet: 0.55,
    cyan: 0.18,
    gold: 0.025,
    amplitude: [5, 13],
    rate: '4s',
  },
  flare: {
    density: 14,
    stroke: 3.5,
    blur: 96,
    violet: 0.78,
    cyan: 0.32,
    gold: 0.035,
    amplitude: [12, 20],
    rate: '2.5s',
  },
  'ping-flash': {
    density: 16,
    stroke: 3.5,
    blur: 136,
    violet: 1,
    cyan: 0.52,
    gold: 0.035,
    amplitude: [12, 20],
    rate: '450ms',
  },
  utulek: {
    density: 10,
    stroke: 1.5,
    blur: 180,
    violet: 0.65,
    cyan: 0.05,
    gold: 0.09,
    amplitude: [10, 22],
    rate: '4.6s',
    spread: 1.55,
  },
  doutnak: {
    density: 5,
    stroke: 1,
    blur: 32,
    violet: 0.22,
    cyan: 0,
    gold: 0.06,
    amplitude: [4, 12],
    rate: '8s',
    spread: 1.35,
  },
};

const svgNamespace = 'http://www.w3.org/2000/svg';
const smokeScriptSrc = 'assets/landing/utulek-fluid.js';

@Component({
  selector: 'puls-landing',
  standalone: true,
  imports: [],
  templateUrl: './landing.component.html',
  styleUrl: './landing.component.scss',
  encapsulation: ViewEncapsulation.None,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LandingComponent implements OnInit, AfterViewInit, OnDestroy {
  private readonly changeDetectorRef = inject(ChangeDetectorRef);
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));
  private readonly timers: ReturnType<typeof setTimeout>[] = [];
  private readonly teardownCallbacks: Array<() => void> = [];
  private readonly reducedMotionQuery = this.isBrowser
    ? window.matchMedia('(prefers-reduced-motion: reduce)')
    : null;

  private scrollUpdateFrame: number | null = null;
  private threadElement: HTMLElement | null = null;
  private threadFiberLayer: SVGGElement | null = null;
  private threadGoldPath: SVGPathElement | null = null;
  private threadLiteQuery: MediaQueryList | null = null;
  private threadLiteMode = false;
  private smokeScriptElement: HTMLScriptElement | null = null;
  private smokeScriptLoaded = false;
  private desiredSmokeActive = false;
  private firstScrollHandled = false;

  isMobileMenuOpen = false;
  activeTierKey: string | null = null;
  heroLogoState: LandingLogoState = 'klid';
  threadState: LandingThreadState = 'klid';
  isGlobalThreadLive = false;
  isReducedMotion = false;
  isHeroThreadVisible = false;
  isHeroThreadDissolving = false;
  activeNarrativeWordIndex: number | null = null;

  readonly sharedOffer = tierSharedOffer;
  readonly narrativeWords = ['Claude', 'Workflow', 'Proces', 'Systém', 'Výstup'];
  readonly tiers: LandingTier[] = [
    {
      key: 'foundation',
      name: 'Foundation',
      labelCs: 'základ',
      description:
        'Zatím bez systému. Claude neznám, nebo ho otevírám namátkou a nevím, jak přesně ho zadat.',
      tagline: 'Od chaosu k prvnímu systému',
      takeaways: [
        'Funkční pracovní systém v Claude: Projects, Memory a tvoji vlastní prompt knihovnu.',
        'Nový návyk: Automaticky sáhneš po AI pokaždé, když narazíš na mechanickou zátěž.',
        'Strukturu zadání: Negeneruje šum, ale rovnou tě dovede k výsledku.',
        'Certifikát za hotový výstup, ne za docházku.',
      ],
    },
    {
      key: 'power',
      name: 'Power',
      labelCs: 'jistota v procesu',
      description:
        'Chaotické workflow. Claude používám, ale výsledky kolísají. Chybí mi proces a opakovatelnost.',
      tagline: 'Od chaosu k opakovatelnosti',
      takeaways: [
        'Pokročilé prompty s XML strukturou: zadání drží napoprvé.',
        'Práci s nástroji v praxi: Chrome, Cowork, Excel, Claude Code.',
        'Workflow knihovnu pro úkoly, které tě dřív stály celé odpoledne.',
        'Nástrojovou mapu: víš, co kdy nasadit a proč.',
        'Certifikát za hotový výstup, ne za docházku.',
      ],
    },
    {
      key: 'advanced',
      name: 'Advanced',
      labelCs: 'stavba nástrojů',
      description:
        'Mám strukturu. Umím používat pokročilé prompty a chci začít stavět vlastní nástroje a automatizovat.',
      tagline: 'Od uživatele k tvůrci',
      takeaways: [
        'Vlastní nástroj postavený v Claude Code.',
        'Integraci s VS Code, Slackem nebo GitHubem.',
        'Znalost prompt injection a obrany proti němu.',
        'První vlastní volání Claude API.',
        'Certifikát za hotový výstup, ne za docházku.',
      ],
    },
    {
      key: 'expert',
      name: 'Expert',
      labelCs: 'produkční úroveň',
      description:
        'Mířím do produkce. Hledám profesionální řešení, vlastní servery a chci stavět produkty pro ostatní.',
      tagline: 'Od tvůrce k produktu',
      takeaways: [
        'Vlastní MCP server napojený na reálná data.',
        'Testování a nasazení do produkce.',
        'Dokumentaci a onboarding, který z projektu dělá produkt, ne prototyp.',
        'Portfolio z celého kurzu.',
        'Certifikát za hotový výstup, ne za docházku.',
      ],
    },
  ];

  ngOnInit(): void {
    if (!this.isBrowser) return;

    this.isReducedMotion = this.prefersReducedMotion();
    this.syncBodyThreadState();
    this.installThreadScrollTracking();

    const prefersReducedMotion = this.isReducedMotion;
    if (prefersReducedMotion || this.hasZazehPlayed()) {
      this.setHeroLogoState('thread');
      this.showHeroNeedle();
      return;
    }

    this.schedule(() => {
      this.setHeroLogoState('puls');
      this.schedule(() => {
        this.setHeroLogoState('thread');
        this.markZazehPlayed();
        this.playNarrativeWords();
        this.schedule(() => this.showHeroNeedle(), localNeedleRevealDelayMs);
      }, logoPulseDurationMs);
    }, logoIntroDelayMs);
  }

  ngAfterViewInit(): void {
    if (!this.isBrowser) return;

    this.threadElement = document.getElementById('puls-thread');
    this.threadFiberLayer = document.getElementById('threadFiberLayer') as SVGGElement | null;
    this.threadGoldPath = document.getElementById('threadGoldPath') as SVGPathElement | null;
    this.threadLiteQuery = window.matchMedia('(max-width: 760px)');
    this.installThreadLiteTracking();
    this.renderThreadFibers(this.threadState);
    this.loadSmokeScript();
  }

  ngOnDestroy(): void {
    this.timers.forEach((timer) => clearTimeout(timer));
    this.teardownCallbacks.forEach((teardown) => teardown());
    if (this.scrollUpdateFrame !== null) cancelAnimationFrame(this.scrollUpdateFrame);
    if (this.isBrowser) {
      this.syncSmokeState(false);
      this.smokeScriptElement?.remove();
      delete (window as PulsWindow).pulsUtulek;
    }
    this.clearBodyThreadState();
  }

  toggleMobileMenu(): void {
    this.isMobileMenuOpen = !this.isMobileMenuOpen;
  }

  closeMobileMenu(): void {
    this.isMobileMenuOpen = false;
  }

  scrollToLandingIntro(event: Event): void {
    this.closeMobileMenu();
    event.preventDefault();
    if (!this.isBrowser) return;

    const headline = document.getElementById('headline');
    const navOffset = 112;
    const top = headline
      ? Math.max(0, headline.getBoundingClientRect().top + window.scrollY - navOffset)
      : 0;

    window.scrollTo({
      top,
      behavior: this.isReducedMotion ? 'auto' : 'smooth',
    });
  }

  selectTier(tierKey: string): void {
    const willCollapse = this.activeTierKey === tierKey;
    this.activeTierKey = willCollapse ? null : tierKey;

    if (!willCollapse) {
      this.anchorTierAfterRender(tierKey, 'detail');
    }
  }

  collapseTier(tierKey: string): void {
    if (this.activeTierKey !== tierKey) return;

    this.activeTierKey = null;
    this.anchorTierAfterRender(tierKey, 'band');
  }

  get activeTier(): LandingTier | null {
    return this.tiers.find((tier) => tier.key === this.activeTierKey) ?? null;
  }

  get renderedHeroLogoState(): Exclude<LandingLogoState, 'klid'> | null {
    return this.heroLogoState === 'klid' ? null : this.heroLogoState;
  }

  tierMailto(prefix: string, tierName: string): string {
    return `mailto:tereza.svanda@praut.cz?subject=${encodeURIComponent(`${prefix} ${tierName}`)}`;
  }

  private anchorTierAfterRender(tierKey: string, target: 'band' | 'detail'): void {
    if (!this.isBrowser) return;

    window.requestAnimationFrame(() => {
      const selector =
        target === 'detail'
          ? `[data-tier-detail="${tierKey}"]`
          : `.tier-band[data-tier="${tierKey}"]`;
      const element = document.querySelector<HTMLElement>(selector);
      if (!element) return;

      const navOffset = target === 'detail' ? 116 : 128;
      const nextTop = element.getBoundingClientRect().top + window.scrollY - navOffset;
      window.scrollTo({
        top: Math.max(0, nextTop),
        behavior: this.isReducedMotion ? 'auto' : 'smooth',
      });

      if (target === 'band') {
        document.querySelector<HTMLElement>(`.tier-band[data-tier="${tierKey}"]`)?.focus({
          preventScroll: true,
        });
      }
    });
  }

  private schedule(callback: () => void, delayMs: number): void {
    this.timers.push(setTimeout(callback, delayMs));
  }

  private setHeroLogoState(state: LandingLogoState): void {
    this.heroLogoState = state;
    this.syncBodyThreadState();
    this.changeDetectorRef.markForCheck();
  }

  private setThreadState(state: LandingThreadState): void {
    if (this.threadState === state) return;
    this.threadState = state;
    this.syncBodyThreadState();
    this.renderThreadFibers(state);
    this.syncSmokeState(state === 'utulek');
    this.changeDetectorRef.markForCheck();
  }

  private activateGlobalThread(): void {
    if (this.isGlobalThreadLive) return;
    this.isGlobalThreadLive = true;
    this.firstScrollHandled = true;
    this.isHeroThreadDissolving = this.isHeroThreadVisible;
    this.isHeroThreadVisible = false;
    if (!this.isHeroThreadDissolving) {
      this.setHeroLogoState('nav');
    }
    this.syncBodyThreadState();
    this.renderThreadFibers(this.threadState);
    this.scheduleThreadUpdate();

    if (this.isHeroThreadDissolving) {
      this.schedule(
        () => {
          this.isHeroThreadDissolving = false;
          this.setHeroLogoState('nav');
          this.syncHeroGhostFromScroll();
          this.changeDetectorRef.markForCheck();
        },
        this.isReducedMotion ? 0 : heroNeedleHandoffDurationMs,
      );
    }
  }

  private showHeroNeedle(): void {
    if (this.isGlobalThreadLive) return;
    this.isHeroThreadVisible = true;
    this.isHeroThreadDissolving = false;
    this.syncBodyThreadState();
    this.changeDetectorRef.markForCheck();
  }

  private playNarrativeWords(): void {
    this.narrativeWords.forEach((_, index) => {
      const wordStartMs = index * narrativeWordStepMs;
      this.schedule(() => this.setActiveNarrativeWord(index), wordStartMs);
      this.schedule(
        () => this.setActiveNarrativeWord(null),
        wordStartMs + narrativeWordVisibleMs + narrativeWordTransitionMs,
      );
    });
  }

  private setActiveNarrativeWord(index: number | null): void {
    this.activeNarrativeWordIndex = index;
    this.changeDetectorRef.markForCheck();
  }

  private hasZazehPlayed(): boolean {
    try {
      return sessionStorage.getItem(logoSessionStorageKey) === '1';
    } catch {
      return false;
    }
  }

  private markZazehPlayed(): void {
    try {
      sessionStorage.setItem(logoSessionStorageKey, '1');
    } catch {
      // The visual sequence is non-critical when storage is blocked.
    }
  }

  private prefersReducedMotion(): boolean {
    return this.reducedMotionQuery?.matches ?? false;
  }

  private syncBodyThreadState(): void {
    if (!this.isBrowser) return;

    document.body.classList.toggle('thread-live', this.isGlobalThreadLive);
    document.body.classList.toggle('thread-unmasked', this.isGlobalThreadLive);
    document.body.classList.toggle('hero-local-thread-visible', this.isHeroThreadVisible);
    document.body.dataset['logoState'] = this.heroLogoState;
    document.body.dataset['threadState'] = this.threadState;
  }

  private clearBodyThreadState(): void {
    if (!this.isBrowser) return;

    document.body.classList.remove(
      'thread-live',
      'thread-unmasked',
      'hero-local-thread-visible',
      'hero-logo-suppressed',
      'hero-ghost-visible',
      'hero-scroll-cue-visible',
    );
    delete document.body.dataset['logoState'];
    delete document.body.dataset['threadState'];
    document.documentElement.classList.remove('thread-lite', 'is-safari', 'thread-static-fallback');
  }

  private installThreadLiteTracking(): void {
    if (!this.threadLiteQuery) return;

    const syncThreadLiteMode = () => {
      const isSafari =
        /^((?!chrome|android).)*safari/i.test(navigator.userAgent) &&
        !/CriOS|FxiOS|EdgiOS/i.test(navigator.userAgent);
      this.threadLiteMode = isSafari || this.threadLiteQuery?.matches || this.isReducedMotion;
      document.documentElement.classList.toggle('thread-lite', this.threadLiteMode);
      document.documentElement.classList.toggle('is-safari', isSafari);
      document.documentElement.classList.toggle(
        'thread-static-fallback',
        isSafari && !this.threadLiteQuery?.matches,
      );
      this.renderThreadFibers(this.threadState);
    };

    syncThreadLiteMode();
    this.threadLiteQuery.addEventListener('change', syncThreadLiteMode);
    this.teardownCallbacks.push(() =>
      this.threadLiteQuery?.removeEventListener('change', syncThreadLiteMode),
    );
  }

  private installThreadScrollTracking(): void {
    const onScrollOrResize = () => this.scheduleThreadUpdate();
    window.addEventListener('scroll', onScrollOrResize, { passive: true });
    window.addEventListener('resize', onScrollOrResize, { passive: true });
    this.teardownCallbacks.push(() => {
      window.removeEventListener('scroll', onScrollOrResize);
      window.removeEventListener('resize', onScrollOrResize);
    });
  }

  private scheduleThreadUpdate(): void {
    if (!this.isBrowser || this.scrollUpdateFrame !== null) return;

    this.scrollUpdateFrame = window.requestAnimationFrame(() => {
      this.scrollUpdateFrame = null;
      this.updateThreadStateFromScroll();
    });
  }

  private updateThreadStateFromScroll(): void {
    const hasScrolled = window.scrollY > 8;
    if (hasScrolled && !this.firstScrollHandled) {
      this.activateGlobalThread();
    }

    this.syncHeroGhostFromScroll();

    if (!this.isGlobalThreadLive) return;

    const anchorY = window.innerHeight * 0.52;
    let activeState: LandingThreadState | null = null;
    let activeDistance = Number.POSITIVE_INFINITY;

    for (const [id, state] of Object.entries(threadSectionStateMap)) {
      const section = document.getElementById(id);
      if (!section) continue;

      const rect = section.getBoundingClientRect();
      if (rect.bottom < 0 || rect.top > window.innerHeight) continue;
      if (id === 'hero' && window.scrollY > 16) continue;

      const sectionCenter = rect.top + rect.height / 2;
      const distance = Math.abs(sectionCenter - anchorY);
      const containsAnchor = rect.top <= anchorY && rect.bottom >= anchorY;
      const weightedDistance = containsAnchor ? distance * 0.35 : distance;

      if (weightedDistance < activeDistance) {
        activeDistance = weightedDistance;
        activeState = state;
      }
    }

    const nextState = activeState ?? 'klid';
    const resolvedState =
      window.matchMedia('(max-width: 760px)').matches && nextState !== 'utulek'
        ? 'klid'
        : nextState;
    this.setThreadState(resolvedState);
  }

  private syncHeroGhostFromScroll(): void {
    if (!this.isBrowser) return;

    const shouldSuppressHeroLogo = this.isGlobalThreadLive && window.scrollY > 8;
    const shouldShowHeroGhost =
      this.isGlobalThreadLive &&
      this.heroLogoState === 'nav' &&
      window.scrollY < window.innerHeight * 0.82;
    const shouldShowHeroScrollCue =
      shouldShowHeroGhost &&
      !this.isHeroThreadDissolving &&
      window.scrollY < window.innerHeight * 0.35;
    document.body.classList.toggle('hero-logo-suppressed', shouldSuppressHeroLogo);
    document.body.classList.toggle('hero-ghost-visible', shouldShowHeroGhost);
    document.body.classList.toggle('hero-scroll-cue-visible', shouldShowHeroScrollCue);
  }

  private renderThreadFibers(state: LandingThreadState): void {
    const config = threadStateConfig[state];
    if (!config || !this.threadFiberLayer || !this.threadGoldPath) return;

    const shouldCrossfade =
      state !== 'ping-flash' && state !== 'zazeh' && this.prepareThreadCrossfade();
    const density = this.threadLiteMode ? Math.max(6, Math.ceil(config.density)) : config.density;
    const random = this.seededRandom(
      [...state].reduce((sum, char) => sum + char.charCodeAt(0), density * 97),
    );
    const spread = config.spread ?? 1;

    this.threadFiberLayer.replaceChildren();
    this.threadFiberLayer.classList.toggle('is-entering', Boolean(shouldCrossfade));
    this.threadGoldPath.classList.toggle('is-entering', Boolean(shouldCrossfade));
    this.applyThreadStateVars(config);

    for (let i = 0; i < density; i += 1) {
      const centerBias = Math.abs(i - (density - 1) / 2) / ((density - 1) / 2 || 1);
      const xOffset = Math.pow(centerBias, 2) * 40 * spread * this.weightedSign(random);
      const phase = this.randomBetween(random, 0, Math.PI * 2);
      const speed = this.randomBetween(random, 0.8, 1.4);
      const amplitudeScale = this.threadLiteMode ? 0.72 : 1;
      const amplitude =
        this.randomBetween(random, config.amplitude[0], config.amplitude[1]) * amplitudeScale;
      const secondaryAmp = this.randomBetween(random, 1.5, 5);
      const path = document.createElementNS(svgNamespace, 'path');
      const cyanShare = this.threadLiteMode
        ? Math.min(0.42, Math.max(config.cyan, state === 'utulek' ? 0.12 : 0.26))
        : config.cyan;
      const minLiteCyan = this.threadLiteMode ? Math.max(2, Math.floor(density * 0.24)) : 0;
      const cyanEvery = minLiteCyan > 0 ? Math.max(2, Math.floor(density / minLiteCyan)) : 0;
      const minLiteGold = this.threadLiteMode ? Math.max(2, Math.floor(density * 0.18)) : 0;
      const goldEvery = minLiteGold > 0 ? Math.max(3, Math.floor(density / minLiteGold)) : 0;
      const isGold = goldEvery > 0 && i % goldEvery === 0;
      const isCyan = !isGold && ((cyanEvery > 0 && i % cyanEvery === 1) || random() < cyanShare);
      const duration = Math.max(
        0.9,
        this.rateToSeconds(config.rate) * this.randomBetween(random, 0.8, 1.4),
      );

      path.setAttribute(
        'd',
        this.buildThreadFiberPath({ xBase: xOffset, phase, amplitude, speed, secondaryAmp }),
      );
      path.setAttribute(
        'class',
        `thread-fiber ${isGold ? 'is-gold' : isCyan ? 'is-cyan' : 'is-violet'}`,
      );
      const opacityLift = this.threadLiteMode ? 1.18 : 1;
      const strokeLift = this.threadLiteMode ? 1.16 : 1;
      const fiberOpacity = isGold
        ? Math.max(0.18, config.gold * 3.2) * this.randomBetween(random, 0.72, 1)
        : config.violet * opacityLift * this.randomBetween(random, 0.58, 1);
      path.style.opacity = String(Math.min(1, fiberOpacity));
      path.style.strokeWidth = `${
        config.stroke * strokeLift * this.randomBetween(random, isGold ? 0.22 : 0.32, 0.72)
      }px`;
      path.style.animationDelay = `${-this.randomBetween(random, 0, duration).toFixed(2)}s`;
      path.style.animationDuration = `${duration.toFixed(2)}s`;
      this.threadFiberLayer.appendChild(path);
    }

    this.threadGoldPath.setAttribute(
      'd',
      this.buildThreadFiberPath({
        xBase: 0,
        phase: 0.8,
        amplitude: state === 'utulek' ? 9 : 8,
        speed: 1,
        secondaryAmp: 2,
      }),
    );

    if (shouldCrossfade) {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          this.threadFiberLayer?.classList.remove('is-entering');
          this.threadGoldPath?.classList.remove('is-entering');
        });
      });
    }
  }

  private applyThreadStateVars(config: ThreadStateConfig): void {
    if (!this.threadElement) return;

    this.threadElement.style.setProperty('--thread-stroke', `${config.stroke}px`);
    this.threadElement.style.setProperty('--thread-blur', `${config.blur}px`);
    this.threadElement.style.setProperty('--thread-opacity', String(config.violet));
    this.threadElement.style.setProperty('--thread-cyan-opacity', String(config.cyan));
    this.threadElement.style.setProperty('--thread-gold-opacity', String(config.gold));
    this.threadElement.style.setProperty('--thread-rate', config.rate);
  }

  private prepareThreadCrossfade(): boolean {
    if (
      this.threadLiteMode ||
      this.isReducedMotion ||
      !this.threadFiberLayer ||
      !this.threadGoldPath ||
      (!this.threadFiberLayer.children.length && !this.threadGoldPath.getAttribute('d'))
    ) {
      return false;
    }

    const previousLayer = this.threadFiberLayer.cloneNode(true) as SVGGElement;
    const previousGold = this.threadGoldPath.cloneNode(true) as SVGPathElement;
    previousLayer.removeAttribute('id');
    previousGold.removeAttribute('id');
    this.threadFiberLayer.parentNode?.insertBefore(previousGold, this.threadGoldPath);
    this.threadFiberLayer.parentNode?.insertBefore(previousLayer, this.threadFiberLayer);
    this.freezeThreadCloneStyles(previousLayer, previousGold);

    previousLayer.animate([{ opacity: 1 }, { opacity: 0 }], {
      duration: 1180,
      easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
      fill: 'forwards',
    });
    previousGold.animate(
      [{ opacity: Number(window.getComputedStyle(previousGold).opacity) || 1 }, { opacity: 0 }],
      {
        duration: 1320,
        easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
        fill: 'forwards',
      },
    );
    this.schedule(() => {
      previousLayer.remove();
      previousGold.remove();
    }, 1320);

    return true;
  }

  private freezeThreadCloneStyles(layerClone: SVGGElement, goldClone: SVGPathElement): void {
    layerClone.querySelectorAll('.thread-fiber').forEach((fiber) => {
      const fiberElement = fiber as SVGPathElement;
      const styles = window.getComputedStyle(fiberElement);
      fiberElement.style.opacity = styles.opacity;
      fiberElement.style.stroke = styles.stroke;
      fiberElement.style.strokeWidth = styles.strokeWidth;
      fiberElement.style.animation = 'none';
    });

    const styles = window.getComputedStyle(goldClone);
    goldClone.style.opacity = styles.opacity;
    goldClone.style.stroke = styles.stroke;
    goldClone.style.strokeWidth = styles.strokeWidth;
    goldClone.style.animation = 'none';
  }

  private buildThreadFiberPath({
    xBase,
    phase,
    amplitude,
    speed,
    secondaryAmp,
  }: {
    xBase: number;
    phase: number;
    amplitude: number;
    speed: number;
    secondaryAmp: number;
  }): string {
    const points: Array<[number, number]> = [];
    const height = 1040;
    const step = 52;

    for (let y = -40; y <= height; y += step) {
      const t = y / height;
      const waveA = Math.sin(t * Math.PI * 4.4 * speed + phase) * amplitude;
      const waveB = Math.sin(t * Math.PI * 9.2 + phase * 0.62) * secondaryAmp;
      const x = 260 + xBase + waveA + waveB;
      points.push([x, y]);
    }

    let d = `M ${points[0][0].toFixed(2)} ${points[0][1].toFixed(2)}`;
    for (let i = 1; i < points.length - 1; i += 1) {
      const current = points[i];
      const next = points[i + 1];
      const cx = current[0].toFixed(2);
      const cy = current[1].toFixed(2);
      const mx = ((current[0] + next[0]) / 2).toFixed(2);
      const my = ((current[1] + next[1]) / 2).toFixed(2);
      d += ` Q ${cx} ${cy} ${mx} ${my}`;
    }

    return d;
  }

  private seededRandom(seed: number): () => number {
    let value = seed % 2147483647;
    return () => {
      value = (value * 16807) % 2147483647;
      return (value - 1) / 2147483646;
    };
  }

  private randomBetween(random: () => number, min: number, max: number): number {
    return min + (max - min) * random();
  }

  private weightedSign(random: () => number): -1 | 1 {
    return random() < 0.5 ? -1 : 1;
  }

  private rateToSeconds(rate: string): number {
    if (rate.endsWith('ms')) return Number.parseFloat(rate) / 1000;
    return Number.parseFloat(rate);
  }

  private loadSmokeScript(): void {
    if (document.getElementById('puls-utulek-fluid-script')) {
      this.smokeScriptLoaded = true;
      this.syncSmokeState(this.desiredSmokeActive);
      return;
    }

    const script = document.createElement('script');
    script.id = 'puls-utulek-fluid-script';
    script.src = smokeScriptSrc;
    script.async = true;
    script.onload = () => {
      this.smokeScriptLoaded = true;
      this.syncSmokeState(this.desiredSmokeActive);
    };
    document.body.appendChild(script);
    this.smokeScriptElement = script;
  }

  private syncSmokeState(isActive: boolean): void {
    this.desiredSmokeActive = isActive;
    if (!this.isBrowser) return;

    const controller = (window as PulsWindow).pulsUtulek;
    if (!this.smokeScriptLoaded || !controller) return;

    if (isActive && !controller.isActive) {
      controller.activate();
    } else if (!isActive && controller.isActive) {
      controller.deactivate();
    }
  }
}

export default LandingComponent;
