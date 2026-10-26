import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './styles/route-styles.css';
import './styles/global.css';
import './styles/design-system.css';
import './styles/print-design-system.css';
import './styles/toast.css';
import './styles/pages/home-production.css';
import './styles/pages/login.css';
import './styles/pages/receipt-wizard.css';
import './styles/pages/receipt-review.css';
import './styles/selects.css';
import './styles/responsive-mobile.css';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
