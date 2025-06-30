import React, { useRef, useEffect } from 'react';
import { Markmap } from 'markmap-view';
import { transformer } from './markmap';
import 'markmap-toolbar/dist/style.css';

type Props = {
  markdown: string;
};

export default function MarkmapHooks({ markdown }: Props) {
  // Ref for SVG element
  const refSvg = useRef<SVGSVGElement>(null);
  // Ref for markmap object
  const refMm = useRef<Markmap>();

  useEffect(() => {
    if (!refSvg.current || refMm.current) return;
    const { root } = transformer.transform(markdown);
    refMm.current = Markmap.create(refSvg.current, undefined, root);
  }, [refSvg.current]);

  useEffect(() => {
    const mm = refMm.current;
    if (!mm) return;
    const { root } = transformer.transform(markdown);
    mm.setData(root).then(() => {
      mm.fit();
    });
  }, [markdown]);

  return (
    <React.Fragment>
      <svg ref={refSvg} style={{ width: '100%', height: '100%' }} />
    </React.Fragment>
  );
}
