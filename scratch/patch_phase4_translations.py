# Patch translations.js with Phase 4 cold storage keys
with open('frontend/src/i18n/translations.js', 'r', encoding='utf-8') as f:
    content = f.read()

en_target = "generalBin: 'General / Bulk Bin',"
en_replacement = """generalBin: 'General / Bulk Bin',
      palletPositions: 'Pallet Positions',
      palletPositionsInBin: (n) => `${n} Pallet Positions`,
      position: 'Position',
      capacity: 'Capacity',
      occupancy: 'Occupancy',
      statusAvailable: 'Available',
      statusReserved: 'Reserved',
      statusOccupied: 'Occupied',
      statusMaintenance: 'Maintenance',
      statusSelected: 'Selected',
      selectPalletPosition: 'Select Pallet Position',
      selectedPalletPosition: 'Selected Pallet Position',
      noPositionSelected: 'Click an available pallet position below',
      reservePosition: 'Reserve Position',
      releaseReservation: 'Release Reservation',
      reservingPosition: 'Reserving...',
      releasingPosition: 'Releasing...',
      positionReservedSuccess: 'Pallet position reserved successfully',
      positionConflictError: 'This pallet position is already reserved or occupied. Please pick another position.',
      loadingLayout: 'Loading physical layout and positions...',
      backToRacks: '← Back to Racks',"""

ar_target = "generalBin: 'مكان عام / أرضي',"
ar_replacement = """generalBin: 'مكان عام / أرضي',
      palletPositions: 'أماكن البليتات',
      palletPositionsInBin: (n) => `${n} مكان بليت`,
      position: 'مكان البليت',
      capacity: 'السعة الكلية',
      occupancy: 'نسبة الإشغال',
      statusAvailable: 'متاح',
      statusReserved: 'محجوز',
      statusOccupied: 'مشغول',
      statusMaintenance: 'صيانة',
      statusSelected: 'محدد',
      selectPalletPosition: 'اختر مكان البليت',
      selectedPalletPosition: 'مكان البليت المحدد',
      noPositionSelected: 'اضغط على مكان بليت متاح أدناه',
      reservePosition: 'حجز المكان',
      releaseReservation: 'إلغاء الحجز',
      reservingPosition: 'جارٍ الحجز...',
      releasingPosition: 'جارٍ إلغاء الحجز...',
      positionReservedSuccess: 'تم حجز مكان البليت بنجاح',
      positionConflictError: 'هذا المكان محجوز أو مشغول بالفعل. يرجى اختيار مكان آخر.',
      loadingLayout: 'جارٍ تحميل السعات وأماكن البليتات...',
      backToRacks: '← العودة للراكات',"""

assert en_target in content, "en_target not found in translations.js"
content = content.replace(en_target, en_replacement, 1)

assert ar_target in content, "ar_target not found in translations.js"
content = content.replace(ar_target, ar_replacement, 1)

with open('frontend/src/i18n/translations.js', 'w', encoding='utf-8') as f:
    f.write(content)

print("translations.js patched successfully with Phase 4 keys!")
