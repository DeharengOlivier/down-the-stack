import { Show, createEffect, createMemo, createSignal, onCleanup, onMount } from 'solid-js';
import { buildJourney, type Journey, type LayerView } from '../core/scenario/journey';
import { buildTimeline, stateAt, type Timeline, type TimelineState } from '../timeline/timeline';
import { createScene, type SceneHandle } from '../render/scene';
import { Inspector, highlightedBytes } from './Inspector';
import { Scrubber } from './Scrubber';
import { PHY_STAGES, stageAt } from '../render/phy-view';
import { locale, setLocale, t, type Locale } from '../content';
import { colorFor } from '../render/palette';

/**
 * Wires the three parts together: the journey (facts), the timeline (pacing)
 * and the scene (pictures). Everything the interface shows is derived from one
 * number, the current position on the timeline.
 */

/** Which layer the panel should describe, chapter by chapter. */
function viewForState(journey: Journey, state: TimelineState): LayerView | undefined {
  const { chapter, progress } = state;
  const pick = (stack: LayerView[], protocol: string) => stack.find((v) => v.protocol === protocol);

  switch (chapter.id) {
    case 'press-enter':
      return journey.dnsStack[0];
    case 'dns-build': {
      const index = Math.min(journey.dnsStack.length - 1, Math.floor(progress * journey.dnsStack.length));
      return journey.dnsStack[index];
    }
    case 'dns-send':
      return journey.dnsStack[0];
    case 'tcp-handshake':
      return pick(journey.requestStack, 'tcp');
    case 'tls-handshake':
      return pick(journey.requestStack, 'tls');
    case 'encapsulation': {
      const index = Math.min(journey.requestStack.length - 1, Math.floor(progress * journey.requestStack.length));
      return journey.requestStack[index];
    }
    case 'physical':
      return undefined;
    case 'hops':
      return pick(journey.requestStack, 'ipv4');
    case 'response':
      return pick(journey.requestStack, 'http');
    default:
      return undefined;
  }
}

export function App() {
  const [journey, setJourney] = createSignal<Journey | null>(null);
  const [timeline, setTimeline] = createSignal<Timeline | null>(null);
  const [time, setTime] = createSignal(0);
  const [playing, setPlaying] = createSignal(true);
  const [speed, setSpeed] = createSignal(1);
  const [selectedByte, setSelectedByte] = createSignal<number | null>(null);
  const [failure, setFailure] = createSignal<string | null>(null);

  let canvas!: HTMLCanvasElement;
  let handle: SceneHandle | null = null;
  let frame = 0;

  const state = createMemo<TimelineState | null>(() => {
    const line = timeline();
    return line ? stateAt(line, time()) : null;
  });

  const view = createMemo<LayerView | undefined>(() => {
    const j = journey();
    const s = state();
    return j && s ? viewForState(j, s) : undefined;
  });

  onMount(() => {
    if (!window.WebGLRenderingContext) {
      setFailure('This page needs WebGL, which this browser does not appear to support.');
      return;
    }
    // Registered before the first await: Solid can only attach a cleanup while
    // the reactive owner is still on the stack.
    const onResize = () => handle?.resize();
    window.addEventListener('resize', onResize);
    onCleanup(() => window.removeEventListener('resize', onResize));
    void start();
  });

  async function start(): Promise<void> {
    try {
      const built = await buildJourney();
      setJourney(built);
      const line = buildTimeline(built);
      setTimeline(line);

      handle = createScene(canvas, built);
      handle.onSelect((selection) => setSelectedByte(selection ? selection.byteIndex : null));

      let last = performance.now();
      let reported = false;
      const loop = (now: number) => {
        const dt = Math.min(0.05, (now - last) / 1000);
        last = now;
        if (playing()) {
          setTime((value) => Math.min(line.totalDuration, value + dt * speed()));
        }
        try {
          const current = stateAt(line, time());
          handle!.update(current);
          handle!.highlight(highlightedBytes(viewForState(built, current), selectedByte()));
          handle!.render();
        } catch (error) {
          // One bad frame must not take the whole scene down with it. Before
          // this guard existed, a single exception here froze the 3D view while
          // the interface carried on updating, which looked like a rendering
          // bug rather than a crash.
          if (!reported) {
            reported = true;
            console.error('[render] frame failed, continuing', error);
          }
        }
        frame = requestAnimationFrame(loop);
      };
      frame = requestAnimationFrame(loop);
    } catch (error) {
      setFailure(error instanceof Error ? error.message : String(error));
    }
  }

  // Text inside the scene is drawn into textures, so it does not react on its
  // own. A language change has to ask the scene to redraw it.
  createEffect(() => {
    locale();
    handle?.refreshLabels();
  });

  onCleanup(() => {
    cancelAnimationFrame(frame);
    handle?.dispose();
  });

  const chapterKey = (suffix: string) => `chapter.${state()?.chapter.id ?? 'press-enter'}.${suffix}`;

  return (
    <div class="app">
      <canvas ref={canvas} class="stage" />

      <Show when={failure()}>
        {(message) => (
          <div class="failure">
            <h1>{t('app.title')}</h1>
            <p>{message()}</p>
          </div>
        )}
      </Show>

      <Show when={!journey() && !failure()}>
        <div class="loading">
          <span class="loading__pulse" />
          <p>{t('app.title')}</p>
        </div>
      </Show>

      <Show when={state()}>
        {(current) => (
          <>
            <header class="topbar">
              <div class="topbar__identity">
                <strong>{t('app.title')}</strong>
                <span>{t('app.tagline')}</span>
              </div>
              <div class="topbar__meta">
                <span class="badge badge--truth" title={t('ui.groundTruth.detail')}>
                  {t('ui.groundTruth')}
                </span>
                <div class="langs">
                  {(['en', 'fr'] as Locale[]).map((code) => (
                    <button
                      type="button"
                      class="langs__item"
                      classList={{ 'langs__item--active': locale() === code }}
                      onClick={() => setLocale(code)}
                    >
                      {code.toUpperCase()}
                    </button>
                  ))}
                </div>
              </div>
            </header>

            <section class="chapter">
              <span class="chapter__index">
                {current().chapterIndex + 1} {t('ui.of')} {timeline()!.chapters.length}
                <Show when={current().chapter.layer !== null}>
                  {' · '}
                  <em style={{ color: colorFor(view()?.protocol ?? 'ipv4') }}>
                    {t('ui.layer')} {current().chapter.layer}
                  </em>
                </Show>
              </span>
              <h1>{t(chapterKey('title'))}</h1>
              <p class="chapter__subtitle">{t(chapterKey('subtitle'))}</p>
              <p class="chapter__body">{t(chapterKey('body'))}</p>

              <Show when={current().chapter.id === 'physical'}>
                <div class="phy-stage">
                  <h2>{t(stageAt(current().progress).key)}</h2>
                  <p>{t(`${stageAt(current().progress).key}.body`)}</p>
                  <ol class="phy-stage__steps">
                    {PHY_STAGES.map((stage) => (
                      <li classList={{ 'is-active': stageAt(current().progress).key === stage.key }}>
                        {t(stage.key)}
                      </li>
                    ))}
                  </ol>
                </div>
              </Show>
            </section>

            <Show when={current().chapter.id !== 'physical'}>
              <Inspector view={view()} selectedByte={selectedByte()} onSelectByte={setSelectedByte} />
            </Show>

            <footer class="bottombar">
              <Scrubber
                timeline={timeline()!}
                state={current()}
                playing={playing()}
                speed={speed()}
                onSeek={(value) => {
                  setTime(value);
                  setPlaying(false);
                }}
                onTogglePlay={() => setPlaying((p) => !p)}
                onSpeed={setSpeed}
              />
            </footer>
          </>
        )}
      </Show>
    </div>
  );
}
