import React from 'react';
import {createRoot} from 'react-dom/client';
import {BrowserRouter,Route,Routes} from 'react-router-dom';
import {AuthProvider} from '../../src/contexts/AuthContext';
import {I18nProvider} from '../../src/contexts/I18nContext';
import {ToastProvider} from '../../src/components/ui/ToastProvider';
import PurchaseQuotationDraftPage from '../../src/pages/PurchaseQuotationDraftPage';
export function VendorLifecycleHarness(){
 return <BrowserRouter><AuthProvider><I18nProvider><ToastProvider><Routes>
  <Route path="/purchase-quotations/:draftId" element={<PurchaseQuotationDraftPage/>}/>
 </Routes></ToastProvider></I18nProvider></AuthProvider></BrowserRouter>;
}
createRoot(document.getElementById('root')).render(<VendorLifecycleHarness/>);
