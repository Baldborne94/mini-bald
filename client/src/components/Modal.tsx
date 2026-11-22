import { useEffect, useId, useRef, type ReactNode } from 'react';
import { Icon } from './Icon.tsx';
import s from './components.module.css';

/** Native <dialog>: focus trap, Esc and backdrop come from the browser. */
export function Modal({ title, onClose, children, wide }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);
  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      className={`${s.modal} ${wide ? s.modalWide : ''}`}
      onClose={onClose}
      onClick={(e) => e.target === ref.current && onClose()}
    >
      <header className={s.modalHead}>
        <h2 id={titleId}>{title}</h2>
        <button type="button" className="btn btn--ghost btn--icon btn--sm" onClick={onClose} aria-label="Close">
          <Icon name="x" />
        </button>
      </header>
      <div className={s.modalBody}>{children}</div>
    </dialog>
  );
}
