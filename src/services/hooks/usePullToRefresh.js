import { useEffect, useRef, useState } from 'react';

const threshold = 64;
const maxPull = 96;
const holdAt = 48;
const shownAtLeastMs = 500;

const usePullToRefresh = (onRefresh) => {
  const ref = useRef(null);
  const latest = useRef(onRefresh);
  latest.current = onRefresh;
  const [pull, setPull] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    const page = ref.current;
    const scroller = page?.closest('.menu-layout') || page?.parentElement;
    if (!page || !scroller) return undefined;
    let startY = null;
    let distance = 0;
    let busy = false;

    const stop = () => {
      startY = null;
      distance = 0;
      setDragging(false);
      setPull(0);
    };
    const start = (event) => {
      startY = !busy && event.touches.length === 1 && scroller.scrollTop <= 0 ? event.touches[0].clientY : null;
      distance = 0;
    };
    const move = (event) => {
      if (startY === null) return;
      const dy = event.touches[0].clientY - startY;
      if (dy <= 0 || scroller.scrollTop > 0) {
        if (distance) stop();
        else startY = null;
        return;
      }
      event.preventDefault();
      distance = Math.min(maxPull, dy * 0.5);
      setDragging(true);
      setPull(distance);
    };
    const end = async () => {
      if (startY === null) return;
      if (distance < threshold) {
        stop();
        return;
      }
      startY = null;
      busy = true;
      setDragging(false);
      setRefreshing(true);
      setPull(holdAt);
      try {
        await Promise.all([
          Promise.resolve().then(() => latest.current()).catch(() => {}),
          new Promise((resolve) => setTimeout(resolve, shownAtLeastMs)),
        ]);
      } finally {
        busy = false;
        setRefreshing(false);
        stop();
      }
    };

    const cancel = () => { if (!busy) stop(); };

    scroller.addEventListener('touchstart', start, { passive: true });
    scroller.addEventListener('touchmove', move, { passive: false });
    scroller.addEventListener('touchend', end);
    scroller.addEventListener('touchcancel', cancel);
    return () => {
      scroller.removeEventListener('touchstart', start);
      scroller.removeEventListener('touchmove', move);
      scroller.removeEventListener('touchend', end);
      scroller.removeEventListener('touchcancel', cancel);
    };
  }, []);

  return { ref, pull, dragging, refreshing, armed: refreshing || pull >= threshold, progress: Math.min(1, pull / threshold) };
};

export default usePullToRefresh;
