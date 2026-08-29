import { For, Show, createMemo } from 'solid-js';
import type { Field } from '../core/types';
import type { LayerView } from '../core/scenario/journey';
import { hasKey, t } from '../content';
import { colorFor } from '../render/palette';

/**
 * The flat half of the interface.
 *
 * Bytes are unreadable in three dimensions, so the hex dump, the field
 * breakdown and the explanation all live here, in type, at right angles to the
 * scene. Selection is shared: clicking a byte here lifts it in the 3D view, and
 * clicking a cube there selects the field that owns it.
 */

export interface InspectorProps {
  view: LayerView | undefined;
  selectedByte: number | null;
  onSelectByte: (index: number | null) => void;
}

/** Byte range a field covers, relative to the start of the layer's bytes. */
export function fieldByteRange(field: Field): [number, number] {
  const start = Math.floor(field.bitOffset / 8);
  const end = Math.ceil((field.bitOffset + field.bitLength) / 8);
  return [start, Math.max(end, start + 1)];
}

/** The layer's explanation, with its numbers substituted in. */
function layerNote(view: LayerView): string {
  let text = t(view.noteKey);
  for (const [name, value] of Object.entries(view.noteValues ?? {})) {
    text = text.replace(`{${name}}`, String(value));
  }
  return text;
}

function flatten(fields: Field[]): Field[] {
  return fields.flatMap((f) => [f, ...(f.children ?? [])]);
}

export function Inspector(props: InspectorProps) {
  const fields = createMemo(() => props.view?.header?.fields ?? []);

  const selectedField = createMemo<Field | null>(() => {
    const index = props.selectedByte;
    if (index === null) return null;
    const candidates = flatten(fields()).filter((f) => {
      const [start, end] = fieldByteRange(f);
      return index >= start && index < end;
    });
    // The narrowest field containing the byte is the most specific answer.
    return candidates.sort((a, b) => a.bitLength - b.bitLength)[0] ?? null;
  });

  const highlighted = createMemo<Set<number>>(() => {
    const field = selectedField();
    if (!field) return new Set();
    const [start, end] = fieldByteRange(field);
    const set = new Set<number>();
    for (let i = start; i < end; i++) set.add(i);
    return set;
  });

  const explanation = createMemo(() => {
    const field = selectedField();
    if (!field) return null;
    const key = `field.${field.key}`;
    return hasKey(key) ? t(key) : null;
  });

  return (
    <aside class="inspector">
      <Show when={props.view} fallback={<p class="inspector__empty">{t('ui.inspector.empty')}</p>}>
        {(view) => (
          <>
            <header class="inspector__header">
              <span class="chip" style={{ '--chip': colorFor(view().protocol) }}>
                L{view().layer} {view().label}
              </span>
              <span class="inspector__size">
                {view().bytes.length} {t('ui.bytes')}
                <Show when={view().headerLength > 0}>
                  {' '}
                  <em>
                    ({view().headerLength + view().trailerLength} {t('ui.overhead')})
                  </em>
                </Show>
              </span>
            </header>

            <p class="inspector__note">{layerNote(view())}</p>

            <Show when={view().protocol === 'wifi'}>
              <p class="inspector__warning">
                <strong>{t('ui.reconstructed')}.</strong> {t('ui.reconstructed.why')}
              </p>
            </Show>

            <h3 class="inspector__label">{t('ui.hexDump')}</h3>
            <div class="hex">
              <For each={Array.from({ length: Math.ceil(Math.min(view().bytes.length, 256) / 16) })}>
                {(_, row) => (
                  <div class="hex__row">
                    <span class="hex__offset">{(row() * 16).toString(16).padStart(4, '0')}</span>
                    <For each={Array.from({ length: 16 })}>
                      {(__, column) => {
                        const index = () => row() * 16 + column();
                        return (
                          <Show when={index() < Math.min(view().bytes.length, 256)}>
                            <button
                              type="button"
                              class="hex__byte"
                              classList={{
                                'hex__byte--header': index() < view().headerLength,
                                'hex__byte--selected': highlighted().has(index()),
                              }}
                              style={{
                                '--byte': index() < view().headerLength ? colorFor(view().protocol) : '#64748b',
                              }}
                              onClick={() => props.onSelectByte(index())}
                            >
                              {view().bytes[index()].toString(16).padStart(2, '0')}
                            </button>
                          </Show>
                        );
                      }}
                    </For>
                  </div>
                )}
              </For>
              <Show when={view().bytes.length > 256}>
                <p class="hex__more">
                  {view().bytes.length - 256} {t('ui.bytes')} …
                </p>
              </Show>
            </div>

            <Show when={selectedField()}>
              {(field) => (
                <div class="field-detail">
                  <h4>{field().label}</h4>
                  <p class="field-detail__value">{field().display}</p>
                  <p class="field-detail__bits">
                    bit {field().bitOffset} … {field().bitOffset + field().bitLength} ({field().bitLength} bit)
                  </p>
                  <Show when={explanation()}>{(text) => <p class="field-detail__why">{text()}</p>}</Show>
                </div>
              )}
            </Show>

            <h3 class="inspector__label">{t('ui.fields')}</h3>
            <ul class="fields">
              <For each={fields()}>
                {(field) => (
                  <li>
                    <button
                      type="button"
                      class="fields__row"
                      classList={{ 'fields__row--active': selectedField()?.key === field.key }}
                      onClick={() => props.onSelectByte(fieldByteRange(field)[0])}
                    >
                      <span class="fields__name">{field.label}</span>
                      <span class="fields__value">{field.display}</span>
                    </button>
                  </li>
                )}
              </For>
            </ul>
          </>
        )}
      </Show>
    </aside>
  );
}

/** Exposed so the scene can lift the same bytes the panel has highlighted. */
export function highlightedBytes(view: LayerView | undefined, selectedByte: number | null): Set<number> {
  if (!view || selectedByte === null) return new Set();
  const candidates = flatten(view.header?.fields ?? []).filter((f) => {
    const [start, end] = fieldByteRange(f);
    return selectedByte >= start && selectedByte < end;
  });
  const field = candidates.sort((a, b) => a.bitLength - b.bitLength)[0];
  if (!field) return new Set([selectedByte]);
  const [start, end] = fieldByteRange(field);
  const set = new Set<number>();
  for (let i = start; i < end; i++) set.add(i);
  return set;
}
