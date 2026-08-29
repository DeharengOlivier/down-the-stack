import { For } from 'solid-js';
import { chapterStart, formatDuration, formatSlowdown, type Timeline, type TimelineState } from '../timeline/timeline';
import { t } from '../content';

/**
 * Time control.
 *
 * The two readouts on the right are the important part: real time elapsed on
 * the wire, and how far the current chapter is slowed down. Without them the
 * viewer would silently conclude that a TLS handshake and an OFDM symbol take
 * comparable amounts of time, when one is ten thousand times longer.
 */

export interface ScrubberProps {
  timeline: Timeline;
  state: TimelineState;
  playing: boolean;
  speed: number;
  onSeek: (t: number) => void;
  onTogglePlay: () => void;
  onSpeed: (speed: number) => void;
}

const SPEEDS = [0.25, 0.5, 1, 2];

export function Scrubber(props: ScrubberProps) {
  return (
    <div class="scrubber">
      <div class="scrubber__controls">
        <button
          type="button"
          class="button button--primary"
          onClick={() => props.onTogglePlay()}
        >
          {props.playing ? t('ui.pause') : t('ui.play')}
        </button>
        <button type="button" class="button" onClick={() => props.onSeek(0)}>
          {t('ui.restart')}
        </button>
        <div class="speeds" role="group" aria-label={t('ui.speed')}>
          <For each={SPEEDS}>
            {(speed) => (
              <button
                type="button"
                class="speeds__item"
                classList={{ 'speeds__item--active': props.speed === speed }}
                onClick={() => props.onSpeed(speed)}
              >
                {speed}×
              </button>
            )}
          </For>
        </div>
      </div>

      <div class="track">
        <input
          type="range"
          min={0}
          max={props.timeline.totalDuration}
          step={0.01}
          value={props.state.t}
          onInput={(event) => props.onSeek(Number(event.currentTarget.value))}
          aria-label={t('ui.chapter')}
        />
        <div class="track__marks">
          <For each={props.timeline.chapters}>
            {(chapter, index) => (
              <button
                type="button"
                class="track__mark"
                classList={{ 'track__mark--active': props.state.chapterIndex === index() }}
                style={{ left: `${(chapterStart(props.timeline, index()) / props.timeline.totalDuration) * 100}%` }}
                title={t(`chapter.${chapter.id}.title`)}
                onClick={() => props.onSeek(chapterStart(props.timeline, index()) + 0.01)}
              >
                <span class="visually-hidden">{t(`chapter.${chapter.id}.title`)}</span>
              </button>
            )}
          </For>
        </div>
      </div>

      {/* Shown where there is a keyboard to use it with. */}
      <p class="shortcuts">{t('ui.shortcuts')}</p>

      <dl class="readout">
        <div>
          <dt>{t('ui.realTime')}</dt>
          <dd>{formatDuration(props.state.realNs)}</dd>
        </div>
        <div>
          <dt>{t('ui.timeScale')}</dt>
          <dd class="readout__scale">{formatSlowdown(props.state.slowdown, t)}</dd>
        </div>
      </dl>
    </div>
  );
}
