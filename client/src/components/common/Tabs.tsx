import { useId, useRef, type KeyboardEvent, type ReactNode } from 'react';

export interface TabItem<K extends string> {
  key: K;
  label: ReactNode;
}

interface Props<K extends string> {
  label: string;
  tabs: TabItem<K>[];
  active: K;
  onChange: (key: K) => void;
  children: ReactNode;
}

// Onglets accessibles (motif WAI-ARIA) : flèches gauche/droite, Début/Fin, onglet actif seul dans l'ordre de tabulation.
export function Tabs<K extends string>({ label, tabs, active, onChange, children }: Props<K>) {
  const baseId = useId();
  const refs = useRef(new Map<K, HTMLButtonElement>());

  function onKeyDown(e: KeyboardEvent) {
    const index = tabs.findIndex((t) => t.key === active);
    const target =
      e.key === 'ArrowRight'
        ? tabs[(index + 1) % tabs.length]
        : e.key === 'ArrowLeft'
          ? tabs[(index - 1 + tabs.length) % tabs.length]
          : e.key === 'Home'
            ? tabs[0]
            : e.key === 'End'
              ? tabs[tabs.length - 1]
              : undefined;
    if (!target) return;
    e.preventDefault();
    onChange(target.key);
    refs.current.get(target.key)?.focus();
  }

  return (
    <>
      <div className="tabs" role="tablist" aria-label={label}>
        {tabs.map((tab) => (
          <button
            key={tab.key}
            ref={(el) => {
              if (el) refs.current.set(tab.key, el);
              else refs.current.delete(tab.key);
            }}
            type="button"
            role="tab"
            id={`${baseId}-tab-${tab.key}`}
            aria-selected={tab.key === active}
            aria-controls={`${baseId}-panel`}
            tabIndex={tab.key === active ? 0 : -1}
            onClick={() => onChange(tab.key)}
            onKeyDown={onKeyDown}
          >
            {tab.label}
          </button>
        ))}
      </div>
      <div role="tabpanel" id={`${baseId}-panel`} aria-labelledby={`${baseId}-tab-${active}`}>
        {children}
      </div>
    </>
  );
}
