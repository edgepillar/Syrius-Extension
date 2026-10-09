import React, { useContext, useLayoutEffect, useRef } from 'react';
import ReactDOM from 'react-dom';
import { ModalContext } from './modalContext';

const focusableControls = (container) => Array.from(container.querySelectorAll(
  'a[href], button, input, select, textarea, [contenteditable="true"], [tabindex]'
)).filter(element => element.tabIndex >= 0 && !element.matches(':disabled') &&
  !element.closest('[hidden], [inert], [aria-hidden="true"]') &&
  element.getClientRects().length > 0 && getComputedStyle(element).visibility === 'visible')
  .sort((left, right) => {
    // Positive tabindex values precede ordinary controls in native Tab order.
    if (left.tabIndex === right.tabIndex) return 0;
    if (left.tabIndex === 0) return 1;
    if (right.tabIndex === 0) return -1;
    return left.tabIndex - right.tabIndex;
  });

const focusDismissal = (container) => {
  const dismiss = focusableControls(container).find(element => element.hasAttribute('data-modal-dismiss'));
  (dismiss || container).focus();
};

const Modal = () => {
  const { modal, modalContent, closeModal } = useContext(ModalContext);
  const root = document.querySelector('#modal-root');
  const container = useRef(null);
  const close = useRef(closeModal);
  close.current = closeModal;

  // Capture the trigger once per opening, including when the content changes.
  // Focus stays in the dialog; opening it never selects a monetary action.
  useLayoutEffect(() => {
    if (!modal || !root) return undefined;
    const trigger = document.activeElement;
    const onKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        close.current();
      } else if (event.key === 'Tab' && container.current) {
        const controls = focusableControls(container.current);
        const first = controls[0], last = controls[controls.length - 1];
        if (!controls.length) {
          event.preventDefault();
          container.current.focus();
        } else if (!controls.includes(document.activeElement) ||
          (event.shiftKey && document.activeElement === first) ||
          (!event.shiftKey && document.activeElement === last)) {
          event.preventDefault();
          (event.shiftKey ? last : first).focus();
        }
      }
    };
    const onFocus = (event) => {
      if (container.current && !container.current.contains(event.target)) focusDismissal(container.current);
    };
    document.addEventListener('keydown', onKeyDown, true);
    document.addEventListener('focusin', onFocus, true);
    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      document.removeEventListener('focusin', onFocus, true);
      if (trigger?.isConnected && typeof trigger.focus === 'function' && !trigger.matches(':disabled') &&
        !trigger.closest('[hidden], [inert], [aria-hidden="true"]') && trigger.getClientRects().length > 0) trigger.focus();
    };
  }, [modal, root]);

  useLayoutEffect(() => {
    if (modal && container.current) focusDismissal(container.current);
  }, [modal, modalContent, root]);

  if (!modal || !root) {
    return null;
  }

  const title = React.isValidElement(modalContent) ? modalContent.props.title : null;
  const name = typeof title === 'string' && title.trim() ? title.trim()
    : typeof title === 'number' && Number.isFinite(title) ? String(title) : 'Wallet dialog';

  return ReactDOM.createPortal(
    <>
      <div className="modal-backdrop" onClick={closeModal} />
      <div className="modal-container text-white" role="dialog" aria-modal="true" aria-label={name} tabIndex={-1} ref={container}>
        {modalContent}
      </div>
    </>,
    root
  );
};

export default Modal;
