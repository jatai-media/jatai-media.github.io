// Inglês é o idioma de referência: toda chave nova nasce aqui.
// Os demais idiomas são tipados a partir deste arquivo e o build
// falha se faltar ou sobrar alguma chave.
//
// Interpolação: use {nome} no texto e passe { nome: valor } para t().

const en = {
  common: {
    brand: 'Jataí',
    language: 'Language',
    backToHub: 'All tools',
    theme: {
      toLight: 'Switch to light mode',
      toDark: 'Switch to dark mode',
    },
  },
  hub: {
    pageTitle: 'Jataí — Free online tools',
    title: 'Free tools, right in your browser',
    subtitle: 'No sign-up, no install. Everything runs on your device.',
    footer: 'Made by Jataí · Open source on GitHub',
    tools: {
      canvas: {
        name: 'Design editor',
        description: 'Create posts, banners and images with text, shapes and photos.',
        open: 'Open editor',
      },
    },
  },
  editor: {
    pageTitle: 'Design editor — Jataí',
    untitled: 'Untitled design',
    tools: {
      select: 'Select',
      text: 'Text',
      rectangle: 'Rectangle',
      ellipse: 'Ellipse',
      line: 'Line',
      image: 'Image',
      draw: 'Draw',
    },
    actions: {
      undo: 'Undo',
      redo: 'Redo',
      export: 'Export',
      exportHint: 'Download as PNG',
      zoomIn: 'Zoom in',
      zoomOut: 'Zoom out',
      fit: 'Fit to screen',
    },
    canvas: {
      title: 'Canvas',
      preset: 'Size',
      custom: 'Custom',
      width: 'Width',
      height: 'Height',
      lockRatio: 'Lock aspect ratio',
      swap: 'Swap orientation',
      background: 'Background',
    },
    presets: {
      instagramPost: 'Instagram post',
      instagramPortrait: 'Instagram portrait',
      story: 'Story / Reels',
      facebookPost: 'Facebook post',
      xPost: 'X (Twitter) post',
      linkedinPost: 'LinkedIn post',
      youtubeThumbnail: 'YouTube thumbnail',
      presentation: 'Presentation 16:9',
      a4: 'A4 document (300 dpi)',
    },
    props: {
      fill: 'Fill',
      stroke: 'Stroke',
      strokeWidth: 'Stroke width',
      radius: 'Corner radius',
      opacity: 'Opacity',
      ratio: 'Aspect ratio',
      font: 'Font',
      fontSize: 'Font size',
      style: 'Style',
      bold: 'Bold',
      textColor: 'Text color',
      alignment: 'Alignment',
      alignLeft: 'Align left',
      alignCenter: 'Align center',
      alignRight: 'Align right',
    },
    arrange: {
      title: 'Arrange',
      front: 'Bring to front',
      forward: 'Bring forward',
      backward: 'Send backward',
      back: 'Send to back',
      duplicate: 'Duplicate',
      delete: 'Delete',
      grouping: 'Grouping',
      group: 'Group (Ctrl+G)',
      ungroup: 'Ungroup (Ctrl+Shift+G)',
    },
    selection: {
      count: '{count} elements selected',
    },
    elements: {
      rectangle: 'Rectangle',
      ellipse: 'Ellipse',
      line: 'Line',
      path: 'Drawing',
      text: 'Text',
      image: 'Image',
      group: 'Group',
    },
    bg: {
      title: 'Remove background',
      tolerance: 'Tolerance',
      interior: 'Also remove enclosed areas',
      apply: 'Remove background',
      working: 'Processing…',
      restore: 'Restore original',
    },
    menu: {
      rename: 'Rename',
      group: 'Group',
      ungroup: 'Ungroup',
      duplicate: 'Duplicate',
      delete: 'Delete',
    },
    layers: {
      toggle: 'Show or hide contents',
    },
    panels: {
      properties: 'Properties',
      layers: 'Layers',
      noSelection: 'Select an element to edit its properties.',
      noLayers: 'No elements yet.',
    },
    status: {
      activeTool: 'Tool: {tool}',
      zoom: 'Zoom: {value}%',
      size: '{width} × {height} px',
      navHint: 'Space + drag to pan · Ctrl + scroll to zoom · Hold Ctrl while dragging to move freely',
    },
  },
};

export default en;
