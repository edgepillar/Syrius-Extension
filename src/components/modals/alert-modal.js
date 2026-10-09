import React, { useContext } from 'react';
import { ModalContext } from '../../services/hooks/modal/modalContext';
import { SelectedTransactionNetwork } from '../transaction-network/transaction-network';

// The confirmation dialog.
//
// Its `returnModalDividerClass` and `returnModalButtons` switches had no
// default branch, so a type it did not recognise rendered a dialog with no
// buttons at all — dismissable only by clicking the backdrop.

const styles = {
  confirm: { accent: 'green', confirmLabel: 'Confirm', confirmClass: 'primary' },
  warning: { accent: 'warning', confirmLabel: 'Proceed', confirmClass: 'warning' },
  danger: { accent: 'warning', confirmLabel: 'Remove', confirmClass: 'warning' },
};

const AlertModal = ({ children, title, type = 'confirm', onDismiss, onSuccess, confirmLabel, transaction = false }) => {
  const { closeModal } = useContext(ModalContext);
  const style = styles[type] || styles.confirm;

  const dismiss = () => {
    closeModal();
    onDismiss?.();
  };

  const confirm = () => {
    closeModal();
    onSuccess?.();
  };

  return (
    <div className="alert-modal" style={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <div className="modal-header" style={{ flexShrink: 0 }}>
        <span>{title}</span>
        <button type="button" className="close-modal" onClick={dismiss} aria-label="Close" data-modal-dismiss>
          <img alt="" src={require('./../../assets/close-icon.svg')} width="12" />
        </button>
      </div>

      <div className={`modal-divider ${style.accent}`} style={{ flexShrink: 0 }} />

      <div className="modal-content" style={{ minHeight: 0, overflowY: 'auto' }}>
        {transaction && <SelectedTransactionNetwork />}
        {children}

        <div className="modal-action-area">
          <button type="button" className="button secondary w-100" onClick={dismiss} data-modal-dismiss>
            Cancel
          </button>
          <button
            type="button"
            className={`button ${style.confirmClass} w-100`}
            onClick={confirm}
          >
            {confirmLabel || style.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
};

export default AlertModal;
