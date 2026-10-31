import React, { useEffect, useState } from 'react';

import Icon from '../icon/icon';
import { sendInternal } from '../../services/utils/messaging';
import { notify } from '../../services/utils/notify';

const pendingKey = 'znn.pendingRequests';
const pollMs = 30000;

const waitingCount = (rows) => Object.values(rows || {}).filter((request) => request && !request.claimId &&
  Number.isInteger(request.windowId) && request.expiresAt > Date.now()).length;

const ApprovalInbox = () => {
  const [count, setCount] = useState(0);
  const [isOpening, setIsOpening] = useState(false);

  useEffect(() => {
    let live = true;
    const read = () => sendInternal('approvals.list').then(
      (rows) => { if (live) setCount(waitingCount(rows)); },
      () => {}
    );
    const changed = (changes, area) => {
      if (area === 'session' && changes[pendingKey]) setCount(waitingCount(changes[pendingKey].newValue));
    };
    read();
    const timer = setInterval(read, pollMs);
    chrome.storage?.onChanged?.addListener(changed);
    return () => {
      live = false;
      clearInterval(timer);
      chrome.storage?.onChanged?.removeListener(changed);
    };
  }, []);

  if (!count) return null;

  const open = async () => {
    setIsOpening(true);
    try {
      await sendInternal('approvals.reopen');
    } catch (error) {
      notify.error(error);
    } finally {
      setIsOpening(false);
    }
  };

  return (
    <button type="button" className="approval-inbox" onClick={open} disabled={isOpening}>
      <Icon name="bell" size={16} />
      <span>{count === 1 ? '1 request waiting' : `${count} requests waiting`}</span>
      <Icon name="chevron-right" size={16} />
    </button>
  );
};

export default ApprovalInbox;
