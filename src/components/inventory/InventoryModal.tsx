import React, { useState } from 'react';
import { X, Plus } from 'lucide-react';
import { useLanguage } from '../../context/LanguageContext';
import { useData } from '../../context/DataContext';
import { InventoryItem, ItemCondition } from '../../types';

interface InventoryModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialItem?: InventoryItem | null;
}

export const InventoryModal: React.FC<InventoryModalProps> = ({
  isOpen,
  onClose,
  initialItem,
}) => {
  const { t, language } = useLanguage();
  const { addInventoryItem, updateInventoryItem, categories, addCategory } = useData();

  const isEdit = !!initialItem;

  const [itemCode, setItemCode] = useState(
    initialItem?.itemCode || `INV-${Math.floor(100 + Math.random() * 900)}`
  );
  const [nameAr, setNameAr] = useState(initialItem?.nameAr || '');
  const [nameEn, setNameEn] = useState(initialItem?.nameEn || '');
  const [category, setCategory] = useState<string>(initialItem?.category || 'chairs');
  const [imageUrl, setImageUrl] = useState(initialItem?.imageUrl || '');
  const [quantity, setQuantity] = useState<number>(initialItem?.quantity || 10);
  const [minStockLevel, setMinStockLevel] = useState<number>(initialItem?.minStockLevel || 2);
  const [storageLocation, setStorageLocation] = useState(initialItem?.storageLocation || '');
  const [condition, setCondition] = useState<ItemCondition>(initialItem?.condition || 'good');
  const [rentalPricePerUnit, setRentalPricePerUnit] = useState<number>(initialItem?.rentalPricePerUnit || 0);
  const [notes, setNotes] = useState(initialItem?.notes || '');

  // Add custom category inline
  const [showNewCatForm, setShowNewCatForm] = useState(false);
  const [newCatKey, setNewCatKey] = useState('');
  const [newCatEn, setNewCatEn] = useState('');
  const [newCatAr, setNewCatAr] = useState('');

  if (!isOpen) return null;

  const handleAddCustomCat = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCatKey.trim() || !newCatEn.trim() || !newCatAr.trim()) return;

    const key = newCatKey.toLowerCase().replace(/\s+/g, '_');
    await addCategory({ id: key, key, nameEn: newCatEn, nameAr: newCatAr });
    setCategory(key);
    setShowNewCatForm(false);
    setNewCatKey('');
    setNewCatEn('');
    setNewCatAr('');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const payload = {
      itemCode,
      nameAr,
      nameEn,
      category,
      imageUrl,
      quantity: Number(quantity),
      minStockLevel: Number(minStockLevel),
      storageLocation,
      condition,
      rentalPricePerUnit: Number(rentalPricePerUnit),
      notes,
    };

    if (isEdit && initialItem) {
      await updateInventoryItem(initialItem.id, payload);
    } else {
      await addInventoryItem(payload);
    }

    onClose();
  };

  return (
    <div onClick={onClose} className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto">
      <div onClick={(e) => e.stopPropagation()} className="bg-white dark:bg-slate-900 w-full max-w-xl rounded-3xl shadow-2xl border border-slate-200 dark:border-slate-800 overflow-hidden flex flex-col my-auto animate-in zoom-in-95 duration-200 max-h-[90vh]">
        <div className="p-5 bg-slate-50 dark:bg-slate-800/80 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
          <h3 className="font-bold text-slate-900 dark:text-white text-lg">
            {isEdit ? t('editItem') : t('newItem')}
          </h3>
          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-lg hover:bg-slate-200 dark:hover:bg-slate-700"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4 overflow-y-auto flex-1">
          <div>
            <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
              {t('itemCode')}
            </label>
            <input
              type="text"
              required
              value={itemCode}
              onChange={(e) => setItemCode(e.target.value)}
              className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white text-sm font-mono font-bold outline-none focus:ring-2 focus:ring-amber-500"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                {t('itemNameAr')}
              </label>
              <input
                type="text"
                required
                value={nameAr}
                onChange={(e) => setNameAr(e.target.value)}
                placeholder="مثال: كراسي شيافاري ذهبية"
                className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white text-sm outline-none focus:ring-2 focus:ring-amber-500"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                {t('itemNameEn')}
              </label>
              <input
                type="text"
                required
                value={nameEn}
                onChange={(e) => setNameEn(e.target.value)}
                placeholder="e.g. Gold Chiavari Chairs"
                className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white text-sm outline-none focus:ring-2 focus:ring-amber-500"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300">
                  {t('category')}
                </label>
                <button
                  type="button"
                  onClick={() => setShowNewCatForm(!showNewCatForm)}
                  className="text-[11px] font-bold text-amber-600 hover:underline flex items-center gap-0.5"
                >
                  <Plus className="w-3 h-3" />
                  <span>{t('addCategory')}</span>
                </button>
              </div>

              <select
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white text-sm outline-none focus:ring-2 focus:ring-amber-500 cursor-pointer"
              >
                {categories.map((cat) => (
                  <option key={cat.key} value={cat.key}>
                    {language === 'ar' ? cat.nameAr : cat.nameEn}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                {t('condition')}
              </label>
              <select
                value={condition}
                onChange={(e) => setCondition(e.target.value as ItemCondition)}
                className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white text-sm outline-none focus:ring-2 focus:ring-amber-500 cursor-pointer"
              >
                <option value="new">{t('conditionNew')}</option>
                <option value="good">{t('conditionGood')}</option>
                <option value="fair">{t('conditionFair')}</option>
                <option value="needs_repair">{t('conditionNeedsRepair')}</option>
                <option value="damaged">{t('conditionDamaged')}</option>
                <option value="maintenance">{t('conditionMaintenance')}</option>
              </select>
            </div>
          </div>

          {showNewCatForm && (
            <div className="p-3 bg-amber-50 dark:bg-amber-950/30 rounded-2xl border border-amber-200 dark:border-amber-800 space-y-2">
              <span className="text-xs font-bold text-amber-800 dark:text-amber-300">{t('addCategory')}</span>
              <div className="grid grid-cols-3 gap-2">
                <input
                  type="text"
                  placeholder="Key (e.g. arches)"
                  value={newCatKey}
                  onChange={(e) => setNewCatKey(e.target.value)}
                  className="px-2 py-1 text-xs rounded-lg border bg-white dark:bg-slate-800"
                />
                <input
                  type="text"
                  placeholder="EN Name"
                  value={newCatEn}
                  onChange={(e) => setNewCatEn(e.target.value)}
                  className="px-2 py-1 text-xs rounded-lg border bg-white dark:bg-slate-800"
                />
                <input
                  type="text"
                  placeholder="AR Name"
                  value={newCatAr}
                  onChange={(e) => setNewCatAr(e.target.value)}
                  className="px-2 py-1 text-xs rounded-lg border bg-white dark:bg-slate-800"
                />
              </div>
              <button
                type="button"
                onClick={handleAddCustomCat}
                className="px-3 py-1 bg-amber-600 text-white rounded-lg text-xs font-bold"
              >
                {t('add')}
              </button>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                {t('quantity')}
              </label>
              <input
                type="number"
                min="1"
                required
                value={quantity}
                onChange={(e) => setQuantity(Number(e.target.value))}
                className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white text-sm outline-none focus:ring-2 focus:ring-amber-500 font-bold"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                {t('minStock')}
              </label>
              <input
                type="number"
                min="0"
                required
                value={minStockLevel}
                onChange={(e) => setMinStockLevel(Number(e.target.value))}
                className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white text-sm outline-none focus:ring-2 focus:ring-amber-500 font-bold"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                Unit Rental Price ($)
              </label>
              <input
                type="number"
                min="0"
                value={rentalPricePerUnit}
                onChange={(e) => setRentalPricePerUnit(Number(e.target.value))}
                className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white text-sm outline-none focus:ring-2 focus:ring-amber-500 font-bold"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
              {t('storageLocation')}
            </label>
            <input
              type="text"
              required
              value={storageLocation}
              onChange={(e) => setStorageLocation(e.target.value)}
              placeholder="e.g. Warehouse A - Shelf 2"
              className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white text-sm outline-none focus:ring-2 focus:ring-amber-500"
            />
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
              Image URL
            </label>
            <input
              type="url"
              value={imageUrl}
              onChange={(e) => setImageUrl(e.target.value)}
              placeholder="https://images.unsplash.com/photo-..."
              className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white text-sm outline-none focus:ring-2 focus:ring-amber-500"
            />
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
              {t('notes')}
            </label>
            <textarea
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Material, dimensions, special care instructions..."
              className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white text-sm outline-none focus:ring-2 focus:ring-amber-500"
            />
          </div>

          <div className="pt-4 border-t border-slate-200 dark:border-slate-800 flex items-center justify-end gap-3">
            <button
              type="button"
              onClick={onClose}
              className="px-5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 text-xs font-bold hover:bg-slate-100 dark:hover:bg-slate-800"
            >
              {t('cancel')}
            </button>
            <button
              type="submit"
              className="px-6 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-600 text-white text-xs font-bold shadow-md shadow-amber-500/20"
            >
              {t('save')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
