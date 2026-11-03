import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import Icon from '../icon/icon';
import { dismissUpdate, pendingUpdate } from '../../services/utils/updateNotice';

const UpdateNotice = () => {
  const navigate = useNavigate();
  const [version, setVersion] = useState(null);

  useEffect(() => {
    let live = true;
    pendingUpdate().then((found) => { if (live) setVersion(found); }, () => {});
    return () => { live = false; };
  }, []);

  if (!version) return null;

  const dismiss = () => {
    setVersion(null);
    dismissUpdate(version);
  };

  return (
    <div className="update-notice">
      <button type="button" className="update-notice-open" onClick={() => navigate('/tabs/settings/about')}>
        <Icon name="download" size={16} />
        <span><span className="mono">{version}</span> available</span>
        <Icon name="chevron-right" size={16} />
      </button>
      <button type="button" className="update-notice-close" onClick={dismiss} aria-label="Dismiss" title="Dismiss">
        <Icon name="close" size={16} />
      </button>
    </div>
  );
};

export default UpdateNotice;
