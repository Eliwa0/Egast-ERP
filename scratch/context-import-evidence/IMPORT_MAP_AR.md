# خريطة المستهلكين المسموحين

الخريطة ساكنة، ولا تشمل محتوى المصادر المحمية. مراجع Python نصوص اختبار وليست استيراد runtime.

| الملف:السطر | النوع / المسار | الأسماء ومواقع الاستخدام |
|---|---|---|
| frontend/scripts/fixtures/purchase-vendor-lifecycle.jsx:4 | static-import: ../../src/contexts/AuthContext | AuthProvider → AuthProvider: 9:25 (jsx-render) |
| frontend/scripts/fixtures/purchase-vendor-lifecycle.jsx:5 | static-import: ../../src/contexts/I18nContext | I18nProvider → I18nProvider: 9:39 (jsx-render) |
| frontend/scripts/fixtures/purchase-vendor-lifecycle.jsx:6 | static-import: ../../src/components/ui/ToastProvider | ToastProvider → ToastProvider: 9:53 (jsx-render) |
| frontend/scripts/fixtures/select-ux-harness.jsx:5 | static-import: ../../src/contexts/AuthContext | AuthProvider → AuthProvider: 34:53 (jsx-render) |
| frontend/scripts/fixtures/select-ux-harness.jsx:6 | static-import: ../../src/contexts/I18nContext | I18nProvider → I18nProvider: 34:67 (jsx-render) |
| frontend/src/App.jsx:9 | static-import: ./contexts/AuthContext | AuthProvider → AuthProvider: 793:8 (jsx-render); useAuth → useAuth: 105:20 (binding-reference), 121:20 (binding-reference), 151:32 (binding-reference) |
| frontend/src/App.jsx:10 | static-import: ./contexts/I18nContext | I18nProvider → I18nProvider: 792:6 (jsx-render); useI18n → useI18n: 94:17 (binding-reference), 135:32 (binding-reference), 152:23 (binding-reference) |
| frontend/src/App.jsx:11 | static-import: ./components/ui/ToastProvider | ToastProvider → ToastProvider: 794:10 (jsx-render) |
| frontend/src/components/customization/CustomizationWorkflowPanel.jsx:3 | static-import: ../../contexts/I18nContext | useI18n → useI18n: 16:23 (binding-reference) |
| frontend/src/components/customization/CustomizationWorkflowPanel.jsx:4 | static-import: ../../contexts/AuthContext | useAuth → useAuth: 17:20 (binding-reference) |
| frontend/src/components/customization/DocumentTraceabilityChain.jsx:4 | static-import: ../../contexts/I18nContext | useI18n → useI18n: 14:20 (binding-reference) |
| frontend/src/components/delivery/DeliveryWorkflowPanel.jsx:2 | static-import: ../../contexts/I18nContext | useI18n → useI18n: 124:23 (binding-reference) |
| frontend/src/components/delivery/DeliveryWorkflowPanel.jsx:3 | static-import: ../../contexts/AuthContext | useAuth → useAuth: 125:20 (binding-reference) |
| frontend/src/components/ProductionPalletCards.jsx:2 | static-import: ../contexts/I18nContext | useI18n → useI18n: 6:20 (binding-reference) |
| frontend/src/components/ProductionPalletTypesPanel.jsx:3 | static-import: ../contexts/I18nContext | useI18n → useI18n: 6:20 (binding-reference) |
| frontend/src/components/ShippingDeliveryHandoff.jsx:3 | static-import: ../contexts/I18nContext | useI18n → useI18n: 9:20 (binding-reference) |
| frontend/src/components/ShippingManifestSummary.jsx:2 | static-import: ../contexts/I18nContext | useI18n → useI18n: 5:20 (binding-reference) |
| frontend/src/components/ui/ActionIconButton.jsx:2 | static-import: ../../contexts/I18nContext | useI18n → useI18n: 62:20 (binding-reference), 97:20 (binding-reference) |
| frontend/src/components/ui/AppLoadingOverlay.jsx:3 | static-import: ../../contexts/I18nContext | useI18n → useI18n: 20:17 (binding-reference) |
| frontend/src/components/ui/AppPageLoader.jsx:4 | static-import: ../../contexts/I18nContext | useI18n → useI18n: 23:17 (binding-reference) |
| frontend/src/components/ui/ConfirmDialog.jsx:2 | static-import: ../../contexts/I18nContext | useI18n → useI18n: 15:17 (binding-reference) |
| frontend/src/components/ui/LoadingSkeleton.jsx:2 | static-import: ../../contexts/I18nContext | useI18n → useI18n: 5:17 (binding-reference) |
| frontend/src/components/ui/RemoteAutocomplete.jsx:6 | static-import: ../../contexts/I18nContext | useI18n → useI18n: 11:23 (binding-reference) |
| frontend/src/components/ui/SearchableSelect.jsx:6 | static-import: ../../contexts/I18nContext | useI18n → useI18n: 91:23 (binding-reference) |
| frontend/src/components/ui/StagedDeleteDialog.jsx:2 | static-import: ../../contexts/I18nContext | useI18n → useI18n: 19:17 (binding-reference) |
| frontend/src/components/ui/StandardDropdown.jsx:3 | static-import: ../../contexts/I18nContext | useI18n → useI18n: 12:23 (binding-reference) |
| frontend/src/components/ui/ToastProvider.jsx:2 | static-import: ../../contexts/I18nContext | useI18n → useI18n: 8:17 (binding-reference) |
| frontend/src/components/ui/WizardStepper.jsx:2 | static-import: ../../context/I18nContext | useI18n → useI18n: 13:17 (binding-reference) |
| frontend/src/components/ui/WorkflowPagination.jsx:1 | static-import: ../../contexts/I18nContext | useI18n → useI18n: 4:17 (binding-reference) |
| frontend/src/hooks/useQualityWizardController.js:3 | static-import: ../contexts/I18nContext | useI18n → useI18n: 100:23 (binding-reference) |
| frontend/src/hooks/useQualityWizardController.js:4 | static-import: ../components/ui/ToastProvider | useToast → useToast: 101:17 (binding-reference) |
| frontend/src/hooks/useRemoteOptions.js:4 | static-import: ../contexts/AuthContext | useAuth → useAuth: 8:20 (binding-reference) |
| frontend/src/modules/transfer/components/ColdStorageMap.jsx:2 | static-import: ../../../contexts/I18nContext | useI18n → useI18n: 90:23 (binding-reference) |
| frontend/src/modules/transfer/components/PhysicalTransfer.jsx:2 | static-import: ../../../contexts/I18nContext | useI18n → useI18n: 7:17 (binding-reference) |
| frontend/src/modules/transfer/hooks/useTransferWorkflow.js:2 | static-import: ../../../contexts/I18nContext | useI18n → useI18n: 17:17 (binding-reference) |
| frontend/src/modules/transfer/hooks/useTransferWorkflow.js:3 | static-import: ../../../contexts/AuthContext | useAuth → useAuth: 18:20 (binding-reference) |
| frontend/src/modules/transfer/pages/TransferPage.jsx:5 | static-import: ../../../contexts/AuthContext | useAuth → useAuth: 154:20 (binding-reference) |
| frontend/src/modules/transfer/pages/TransferPage.jsx:6 | static-import: ../../../contexts/I18nContext | useI18n → useI18n: 104:17 (binding-reference), 155:23 (binding-reference) |
| frontend/src/pages/ActivityLogPage.jsx:7 | static-import: ../contexts/I18nContext | useI18n → useI18n: 228:23 (binding-reference), 356:17 (binding-reference) |
| frontend/src/pages/CreateUserPage.jsx:6 | static-import: ../contexts/AuthContext | useAuth → useAuth: 13:20 (binding-reference) |
| frontend/src/pages/CreateUserPage.jsx:7 | static-import: ../contexts/I18nContext | useI18n → useI18n: 14:17 (binding-reference) |
| frontend/src/pages/CustomizationDeliveryPage.jsx:3 | static-import: ../contexts/I18nContext | useI18n → useI18n: 11:23 (binding-reference) |
| frontend/src/pages/CustomizationDeliveryPage.jsx:4 | static-import: ../contexts/AuthContext | useAuth → useAuth: 12:20 (binding-reference) |
| frontend/src/pages/CustomizationDetailPage.jsx:2 | static-import: ../contexts/I18nContext | useI18n → useI18n: 8:17 (binding-reference) |
| frontend/src/pages/CustomizationPage.jsx:2 | static-import: ../contexts/I18nContext | useI18n → useI18n: 10:17 (binding-reference) |
| frontend/src/pages/DeliveriesPage.jsx:21 | static-import: ../contexts/I18nContext | useI18n → useI18n: 41:23 (binding-reference) |
| frontend/src/pages/DeliveriesPage.jsx:22 | static-import: ../components/ui/ToastProvider | useToast → useToast: 42:17 (binding-reference) |
| frontend/src/pages/DeliveriesPage.jsx:23 | static-import: ../contexts/AuthContext | useAuth → useAuth: 43:20 (binding-reference) |
| frontend/src/pages/DeliveryCreateWizardPage.jsx:27 | static-import: ../contexts/I18nContext | useI18n → useI18n: 92:23 (binding-reference) |
| frontend/src/pages/DeliveryCreateWizardPage.jsx:28 | static-import: ../components/ui/ToastProvider | useToast → useToast: 93:17 (binding-reference) |
| frontend/src/pages/DeliveryCreateWizardPage.jsx:29 | static-import: ../contexts/AuthContext | useAuth → useAuth: 94:20 (binding-reference) |
| frontend/src/pages/DeliveryDetailPage.jsx:2 | static-import: ../contexts/I18nContext | useI18n → useI18n: 8:23 (binding-reference) |
| frontend/src/pages/DeliveryPage.jsx:2 | static-import: ../contexts/I18nContext | useI18n → useI18n: 8:17 (binding-reference) |
| frontend/src/pages/DeliveryReviewPage.jsx:8 | static-import: ../contexts/I18nContext | useI18n → useI18n: 44:23 (binding-reference) |
| frontend/src/pages/DeliveryReviewPage.jsx:9 | static-import: ../components/ui/ToastProvider | useToast → useToast: 46:17 (binding-reference) |
| frontend/src/pages/GRPOPage.jsx:4 | static-import: ../contexts/I18nContext | useI18n → useI18n: 20:23 (binding-reference) |
| frontend/src/pages/GRPOPage.jsx:5 | static-import: ../components/ui/ToastProvider | useToast → useToast: 21:17 (binding-reference) |
| frontend/src/pages/GRPOReviewPage.jsx:14 | static-import: ../contexts/I18nContext | useI18n → useI18n: 29:23 (binding-reference) |
| frontend/src/pages/GRPOReviewPage.jsx:15 | static-import: ../components/ui/ToastProvider | useToast → useToast: 30:17 (binding-reference) |
| frontend/src/pages/Home.jsx:3 | static-import: ../contexts/I18nContext | useI18n → useI18n: 17:23 (binding-reference) |
| frontend/src/pages/Home.jsx:4 | static-import: ../contexts/AuthContext | useAuth → useAuth: 18:20 (binding-reference) |
| frontend/src/pages/InspectionStagesManagementPage.jsx:4 | static-import: ../contexts/AuthContext | useAuth → useAuth: 98:20 (binding-reference) |
| frontend/src/pages/InspectionStagesManagementPage.jsx:5 | static-import: ../contexts/I18nContext | useI18n → useI18n: 97:17 (binding-reference) |
| frontend/src/pages/InspectionStagesManagementPage.jsx:6 | static-import: ../components/ui/ToastProvider | useToast → useToast: 99:17 (binding-reference) |
| frontend/src/pages/IssueReviewPage.jsx:17 | static-import: ../contexts/I18nContext | useI18n → useI18n: 46:17 (binding-reference), 102:17 (binding-reference), 173:17 (binding-reference), 245:17 (binding-reference), 384:17 (binding-reference) |
| frontend/src/pages/IssueReviewPage.jsx:18 | static-import: ../contexts/AuthContext | useAuth → useAuth: 385:20 (binding-reference) |
| frontend/src/pages/IssueWizard.jsx:21 | static-import: ../contexts/I18nContext | useI18n → useI18n: 40:23 (binding-reference) |
| frontend/src/pages/IssueWizard.jsx:22 | static-import: ../contexts/AuthContext | useAuth → useAuth: 41:20 (binding-reference) |
| frontend/src/pages/ItemCriteriaMappingPage.jsx:5 | static-import: ../contexts/I18nContext | useI18n → useI18n: 32:17 (binding-reference) |
| frontend/src/pages/ItemCriteriaMappingPage.jsx:6 | static-import: ../components/ui/ToastProvider | useToast → useToast: 33:17 (binding-reference) |
| frontend/src/pages/LoginPage.jsx:4 | static-import: ../contexts/AuthContext | useAuth → useAuth: 15:25 (binding-reference) |
| frontend/src/pages/LoginPage.jsx:5 | static-import: ../contexts/I18nContext | useI18n → useI18n: 16:17 (binding-reference) |
| frontend/src/pages/Production.jsx:4 | static-import: ../contexts/I18nContext | useI18n → useI18n: 9:17 (binding-reference) |
| frontend/src/pages/ProductionOrderRulesPage.jsx:5 | static-import: ../contexts/AuthContext | useAuth → useAuth: 1547:20 (binding-reference) |
| frontend/src/pages/ProductionOrderRulesPage.jsx:6 | static-import: ../contexts/I18nContext | useI18n → useI18n: 267:17 (binding-reference), 282:17 (binding-reference), 351:17 (binding-reference), 371:17 (binding-reference), 697:17 (binding-reference), 983:17 (binding-reference), 1244:17 (binding-reference), 1548:23 (binding-reference) |
| frontend/src/pages/PurchaseGRPODraftPage.jsx:7 | static-import: ../contexts/I18nContext | useI18n → useI18n: 260:17 (binding-reference) |
| frontend/src/pages/PurchaseGRPODraftPage.jsx:8 | static-import: ../contexts/AuthContext | useAuth → useAuth: 261:20 (binding-reference) |
| frontend/src/pages/PurchaseGRPODraftPage.jsx:10 | static-import: ../components/ui/ToastProvider | useToast → useToast: 262:17 (binding-reference) |
| frontend/src/pages/PurchaseQuotationDraftPage.jsx:6 | static-import: ../contexts/I18nContext | useI18n → useI18n: 121:23 (binding-reference) |
| frontend/src/pages/PurchaseQuotationDraftPage.jsx:7 | static-import: ../contexts/AuthContext | useAuth → useAuth: 116:20 (binding-reference) |
| frontend/src/pages/PurchaseQuotationDraftPage.jsx:9 | static-import: ../components/ui/ToastProvider | useToast → useToast: 122:17 (binding-reference) |
| frontend/src/pages/PurchaseQuotationReviewPage.jsx:4 | static-import: ../contexts/I18nContext | useI18n → useI18n: 38:23 (binding-reference) |
| frontend/src/pages/PurchaseQuotationReviewPage.jsx:5 | static-import: ../components/ui/ToastProvider | useToast → useToast: 39:17 (binding-reference) |
| frontend/src/pages/QualityCategoriesManagementPage.jsx:3 | static-import: ../contexts/I18nContext | useI18n → useI18n: 94:17 (binding-reference) |
| frontend/src/pages/QualityCategoriesManagementPage.jsx:4 | static-import: ../components/ui/ToastProvider | useToast → useToast: 95:17 (binding-reference) |
| frontend/src/pages/QualityCriteriaManagementPage.jsx:4 | static-import: ../contexts/I18nContext | useI18n → useI18n: 149:17 (binding-reference) |
| frontend/src/pages/QualityCriteriaManagementPage.jsx:5 | static-import: ../components/ui/ToastProvider | useToast → useToast: 150:17 (binding-reference) |
| frontend/src/pages/QualityLandingPage.jsx:3 | static-import: ../contexts/I18nContext | useI18n → useI18n: 8:17 (binding-reference) |
| frontend/src/pages/QualityReviewPage.jsx:5 | static-import: ../contexts/AuthContext | useAuth → useAuth: 248:20 (binding-reference) |
| frontend/src/pages/QualityReviewPage.jsx:7 | static-import: ../contexts/I18nContext | useI18n → useI18n: 249:17 (binding-reference) |
| frontend/src/pages/QualityReviewPage.jsx:8 | static-import: ../components/ui/ToastProvider | useToast → useToast: 250:17 (binding-reference) |
| frontend/src/pages/ReceiptReviewPage.jsx:8 | static-import: ../contexts/AuthContext | useAuth → useAuth: 466:20 (binding-reference) |
| frontend/src/pages/ReceiptReviewPage.jsx:9 | static-import: ../contexts/I18nContext | useI18n → useI18n: 144:17 (binding-reference), 161:17 (binding-reference), 203:17 (binding-reference), 300:17 (binding-reference), 393:17 (binding-reference), 467:23 (binding-reference) |
| frontend/src/pages/ReceiptWizard.jsx:11 | static-import: ../contexts/AuthContext | useAuth → useAuth: 301:20 (binding-reference) |
| frontend/src/pages/ReceiptWizard.jsx:12 | static-import: ../contexts/I18nContext | useI18n → useI18n: 177:17 (binding-reference), 224:17 (binding-reference), 302:23 (binding-reference) |
| frontend/src/pages/ReceivingInspectionWizard.jsx:4 | static-import: ../contexts/AuthContext | useAuth → useAuth: 25:20 (binding-reference) |
| frontend/src/pages/RulesHubPage.jsx:4 | static-import: ../contexts/AuthContext | useAuth → useAuth: 10:20 (binding-reference) |
| frontend/src/pages/RulesHubPage.jsx:5 | static-import: ../contexts/I18nContext | useI18n → useI18n: 11:17 (binding-reference) |
| frontend/src/pages/SalesDocumentDetailPage.jsx:17 | static-import: ../contexts/I18nContext | useI18n → useI18n: 42:23 (binding-reference) |
| frontend/src/pages/SalesDocumentListPage.jsx:18 | static-import: ../contexts/I18nContext | useI18n → useI18n: 48:17 (binding-reference) |
| frontend/src/pages/SalesOrdersPage.jsx:20 | static-import: ../contexts/I18nContext | useI18n → useI18n: 36:23 (binding-reference) |
| frontend/src/pages/SalesOrdersPage.jsx:21 | static-import: ../components/ui/ToastProvider | useToast → useToast: 37:17 (binding-reference) |
| frontend/src/pages/SalesOrdersReviewPage.jsx:19 | static-import: ../contexts/I18nContext | useI18n → useI18n: 40:23 (binding-reference) |
| frontend/src/pages/SalesOrdersReviewPage.jsx:20 | static-import: ../components/ui/ToastProvider | useToast → useToast: 42:17 (binding-reference) |
| frontend/src/pages/SalesQuotationCreatePage.jsx:26 | static-import: ../contexts/I18nContext | useI18n → useI18n: 59:23 (binding-reference) |
| frontend/src/pages/SalesQuotationCreatePage.jsx:27 | static-import: ../components/ui/ToastProvider | useToast → useToast: 60:17 (binding-reference) |
| frontend/src/pages/SalesQuotationsPage.jsx:23 | static-import: ../contexts/I18nContext | useI18n → useI18n: 49:23 (binding-reference) |
| frontend/src/pages/SalesQuotationsPage.jsx:24 | static-import: ../components/ui/ToastProvider | useToast → useToast: 50:17 (binding-reference) |
| frontend/src/pages/SalesQuotationsPage.jsx:25 | static-import: ../contexts/AuthContext | useAuth → useAuth: 51:20 (binding-reference) |
| frontend/src/pages/SalesQuotationsReviewPage.jsx:22 | static-import: ../contexts/I18nContext | useI18n → useI18n: 39:23 (binding-reference) |
| frontend/src/pages/SalesQuotationsReviewPage.jsx:23 | static-import: ../components/ui/ToastProvider | useToast → useToast: 41:17 (binding-reference) |
| frontend/src/pages/ShippingDeliveryPage.jsx:4 | static-import: ../contexts/I18nContext | useI18n → useI18n: 21:23 (binding-reference) |
| frontend/src/pages/ShippingDeliveryPage.jsx:5 | static-import: ../contexts/AuthContext | useAuth → useAuth: 22:20 (binding-reference) |
| frontend/src/pages/ShippingDeliveryPage.jsx:7 | static-import: ../components/ui/ToastProvider | useToast → useToast: 24:17 (binding-reference) |
| frontend/src/pages/ShippingLoadingPage.jsx:2 | static-import: ../contexts/I18nContext | useI18n → useI18n: 20:20 (binding-reference) |
| frontend/src/pages/ShippingLoadingPage.jsx:3 | static-import: ../contexts/AuthContext | useAuth → useAuth: 21:20 (binding-reference) |
| frontend/src/pages/ShippingReceivingPage.jsx:3 | static-import: ../contexts/I18nContext | useI18n → useI18n: 10:17 (binding-reference) |
| frontend/src/pages/ShippingReceivingPage.jsx:4 | static-import: ../contexts/AuthContext | useAuth → useAuth: 11:20 (binding-reference) |
| frontend/src/pages/TransferReviewPage.jsx:5 | static-import: ../contexts/AuthContext | useAuth → useAuth: 123:20 (binding-reference) |
| frontend/src/pages/TransferReviewPage.jsx:8 | static-import: ../contexts/I18nContext | useI18n → useI18n: 124:17 (binding-reference) |
| frontend/src/pages/TransferRulesPage.jsx:6 | static-import: ../contexts/AuthContext | useAuth → useAuth: 25:20 (binding-reference) |
| frontend/src/pages/TransferRulesPage.jsx:7 | static-import: ../contexts/I18nContext | useI18n → useI18n: 26:17 (binding-reference) |
| frontend/src/pages/UserManagementPage.jsx:11 | static-import: ../contexts/AuthContext | useAuth → useAuth: 100:24 (binding-reference) |
| frontend/src/pages/UserManagementPage.jsx:12 | static-import: ../contexts/I18nContext | useI18n → useI18n: 57:17 (binding-reference), 101:17 (binding-reference) |
