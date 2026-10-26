import{i as e,n as t,r as n}from"./I18nContext-B8z1OFo1.js";import{O as r}from"./index-Xw-z9X3u.js";import{t as i}from"./PageHeader-u6pETJqK.js";e();var a=n();function o(){let e=r(),{t:n}=t(),o=[{path:`/scale/entry-exit-permits/entry`,icon:`🚪`,title:n(`scale.entryPermitTitle`),description:n(`scale.entryPermitSubtitle`),buttonLabel:n(`scale.openEntryPermit`),accent:`nav-card__icon--production`},{path:`/scale/entry-exit-permits/exit`,icon:`🚛`,title:n(`scale.exitPermitTitle`),description:n(`scale.exitPermitSubtitle`),buttonLabel:n(`scale.openExitPermit`),accent:`nav-card__icon--transfer`}];return(0,a.jsxs)(`div`,{className:`home-page scale-permits-selection-page`,children:[(0,a.jsx)(i,{eyebrow:n(`scale.title`),title:n(`scale.entryExitPermitsTitle`),description:n(`scale.entryExitPermitsSubtitle`)}),(0,a.jsx)(`div`,{className:`pep-actions`,children:o.map(t=>(0,a.jsxs)(`section`,{className:`card-panel pep-action-card`,onClick:()=>e(t.path),onKeyDown:n=>{(n.key===`Enter`||n.key===` `)&&(n.preventDefault(),e(t.path))},role:`button`,tabIndex:0,"aria-label":t.title,children:[(0,a.jsx)(`div`,{className:`pep-icon ${t.accent}`,children:t.icon}),(0,a.jsx)(`h2`,{className:`pep-title`,children:t.title}),(0,a.jsx)(`p`,{className:`pep-desc`,children:t.description}),(0,a.jsx)(`button`,{type:`button`,className:`app-button app-button--primary app-button--block app-button--cta`,onClick:n=>{n.stopPropagation(),e(t.path)},children:t.buttonLabel})]},t.path))}),(0,a.jsx)(`style`,{children:`
        .scale-permits-selection-page { padding-bottom: 40px; }
        .pep-actions {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 20px;
          width: min(900px, 100%);
          margin: 0 auto;
        }
        .pep-action-card {
          display: flex;
          flex-direction: column;
          gap: 14px;
          padding: 26px;
          min-height: 240px;
          text-align: start;
          cursor: pointer;
          transition: transform 0.16s ease, box-shadow 0.16s ease, border-color 0.16s ease;
        }
        .pep-action-card:hover {
          transform: translateY(-2px);
          border-color: var(--color-primary);
          box-shadow: var(--shadow-md);
        }
        .pep-icon {
          display: grid;
          place-items: center;
          width: 62px;
          height: 62px;
          border-radius: 16px;
          font-size: 30px;
          line-height: 1;
        }
        .pep-icon.nav-card__icon--production {
          background: var(--bg-success-soft);
          border-color: color-mix(in srgb, var(--success) 28%, transparent);
        }
        .pep-icon.nav-card__icon--transfer {
          background: var(--bg-primary-soft);
          border-color: color-mix(in srgb, var(--primary) 28%, transparent);
        }
        .pep-title { margin: 0; font-size: 1.35rem; color: var(--color-text); }
        .pep-desc { margin: 0; color: var(--color-text-muted); line-height: 1.55; }
        .pep-action-card .app-button--cta { margin-top: auto; }

        @media (max-width: 720px) {
          .pep-actions { grid-template-columns: 1fr; width: min(480px, 100%); }
        }
      `})]})}export{o as ScaleEntryExitPermitsPage,o as default};