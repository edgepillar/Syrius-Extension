import { useEffect, useState } from 'react';
import { captureReadContext, subscribeReadContext } from '../wallet/readContext';

const useReadContext = () => {
  const context = captureReadContext();
  const [key, setKey] = useState(context.key);
  useEffect(() => {
    const update = () => setKey(captureReadContext().key);
    const unsubscribe = subscribeReadContext(update);
    // Cover a connection change between render and effect subscription.
    if (captureReadContext().key !== key) update();
    return unsubscribe;
    // The callback reads the current identity; this subscription lasts a mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return context;
};

export default useReadContext;
