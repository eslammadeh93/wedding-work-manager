import React, { useState } from 'react';
import {
  Boxes,
  Plus,
  Search,
  AlertTriangle,
  MapPin,
  Edit,
  Trash2,
  CheckCircle,
  Tag,
  DollarSign,
} from 'lucide-react';
import { useLanguage } from '../../context/LanguageContext';
import { useData } from '../../context/DataContext';
import { InventoryItem } from '../../types';
import { InventoryModal } from './InventoryModal';

export const InventoryModule: React.FC = () => {
  const { t, language } = useLanguage();
  const { inventory, deleteInventoryItem, categories } = useData();

  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<InventoryItem | null>(null);

  const filteredInventory = inventory.filter((item) => {
    const codeMatch = item.itemCode?.toLowerCase().includes(searchTerm.toLowerCase());
    const nameArMatch = item.nameAr.toLowerCase().includes(searchTerm.toLowerCase());
    const nameEnMatch = item.nameEn.toLowerCase().includes(searchTerm.toLowerCase());
    const locMatch = item.storageLocation.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesSearch = codeMatch || nameArMatch || nameEnMatch || locMatch;

    const matchesCategory = selectedCategory === 'all' || item.category === selectedCategory;

    return matchesSearch && matchesCategory;
  });

  const handleDelete = async (id: string) => {
    if (window.confirm(t('confirmDelete'))) {
      await deleteInventoryItem(id);
    }
  };

  const getConditionBadge = (condition: string) => {
    switch (condition) {
      case 'new':
        return 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300';
      case 'good':
        return 'bg-blue-100 text-blue-800 dark:bg-blue-950/60 dark:text-blue-300';
      case 'fair':
        return 'bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300';
      case 'needs_repair':
      case 'maintenance':
        return 'bg-orange-100 text-orange-800 dark:bg-orange-950/60 dark:text-orange-300';
      case 'damaged':
        return 'bg-rose-100 text-rose-800 dark:bg-rose-950/60 dark:text-rose-300';
      default:
        return 'bg-slate-100 text-slate-800';
    }
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-slate-900 dark:text-white flex items-center gap-2">
            <Boxes className="w-6 h-6 text-amber-500" />
            <span>{t('inventory')}</span>
          </h2>
        </div>

        <button
          onClick={() => {
            setEditingItem(null);
            setIsModalOpen(true);
          }}
          className="px-5 py-2.5 bg-amber-500 hover:bg-amber-600 text-white font-bold text-xs sm:text-sm rounded-xl shadow-md shadow-amber-500/20 transition-all cursor-pointer flex items-center gap-2"
        >
          <Plus className="w-4 h-4" />
          <span>{t('newItem')}</span>
        </button>
      </div>

      {/* Categories Horizontal Scrolling Tabs */}
      <div className="flex items-center gap-2 overflow-x-auto pb-2 scrollbar-none">
        <button
          onClick={() => setSelectedCategory('all')}
          className={`px-4 py-2 rounded-xl text-xs font-bold whitespace-nowrap transition-all cursor-pointer ${
            selectedCategory === 'all'
              ? 'bg-amber-500 text-white shadow-md shadow-amber-500/20'
              : 'bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 border border-slate-200 dark:border-slate-800'
          }`}
        >
          {t('all')}
        </button>
        {categories.map((cat) => {
          const isActive = selectedCategory === cat.key;
          return (
            <button
              key={cat.id || cat.key}
              onClick={() => setSelectedCategory(cat.key)}
              className={`px-4 py-2 rounded-xl text-xs font-bold whitespace-nowrap transition-all cursor-pointer ${
                isActive
                  ? 'bg-amber-500 text-white shadow-md shadow-amber-500/20'
                  : 'bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 border border-slate-200 dark:border-slate-800'
              }`}
            >
              {language === 'ar' ? cat.nameAr : cat.nameEn}
            </button>
          );
        })}
      </div>

      {/* Search Input */}
      <div className="p-4 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm">
        <div className="relative">
          <Search className="w-4 h-4 text-slate-400 absolute ltr:left-3.5 rtl:right-3.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Search items by code, name, location, category..."
            className="w-full ltr:pl-10 rtl:pr-10 ltr:pr-4 rtl:pl-4 py-2 bg-slate-50 dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-medium text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-amber-500"
          />
        </div>
      </div>

      {/* Inventory Grid Cards */}
      {filteredInventory.length === 0 ? (
        <div className="p-12 text-center bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800">
          <Boxes className="w-12 h-12 mx-auto text-amber-500 opacity-40 mb-3" />
          <p className="text-sm font-bold text-slate-700 dark:text-slate-300">{t('noData')}</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {filteredInventory.map((item) => {
            const isLowStock = item.availableQuantity <= item.minStockLevel;
            const itemName = language === 'ar' ? item.nameAr : item.nameEn;
            const categoryObj = categories.find((c) => c.key === item.category);
            const categoryLabel = categoryObj
              ? language === 'ar'
                ? categoryObj.nameAr
                : categoryObj.nameEn
              : item.category;

            return (
              <div
                key={item.id}
                className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden flex flex-col justify-between hover:shadow-md transition-all group"
              >
                <div>
                  {/* Image */}
                  <div className="h-44 w-full bg-slate-100 dark:bg-slate-800 relative overflow-hidden">
                    {item.imageUrl ? (
                      <img
                        src={item.imageUrl}
                        alt={itemName}
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-slate-300">
                        <Boxes className="w-12 h-12" />
                      </div>
                    )}

                    {/* Code badge */}
                    <div className="absolute top-3 ltr:left-3 rtl:right-3">
                      <span className="px-2.5 py-1 bg-slate-900/80 text-amber-400 text-[11px] font-mono font-bold rounded-lg backdrop-blur-xs">
                        {item.itemCode || 'INV'}
                      </span>
                    </div>

                    {/* Stock status overlay pill */}
                    <div className="absolute top-3 ltr:right-3 rtl:left-3 flex items-center gap-1">
                      {isLowStock ? (
                        <span className="px-2.5 py-1 bg-rose-500 text-white text-[10px] font-extrabold rounded-full shadow-md flex items-center gap-1 animate-pulse">
                          <AlertTriangle className="w-3 h-3" />
                          Low Stock
                        </span>
                      ) : (
                        <span className="px-2.5 py-1 bg-emerald-500 text-white text-[10px] font-extrabold rounded-full shadow-md flex items-center gap-1">
                          <CheckCircle className="w-3 h-3" />
                          In Stock
                        </span>
                      )}
                    </div>

                    {/* Category pill */}
                    <div className="absolute bottom-3 ltr:left-3 rtl:right-3">
                      <span className="px-2.5 py-1 bg-slate-900/80 text-white text-[10px] font-bold rounded-lg backdrop-blur-xs flex items-center gap-1">
                        <Tag className="w-3 h-3 text-amber-400" />
                        {categoryLabel}
                      </span>
                    </div>
                  </div>

                  {/* Body Info */}
                  <div className="p-4 space-y-2">
                    <h3 className="font-bold text-sm text-slate-900 dark:text-white group-hover:text-amber-600 transition-colors">
                      {itemName}
                    </h3>

                    <p className="text-xs text-slate-500 flex items-center gap-1">
                      <MapPin className="w-3.5 h-3.5 text-rose-500 shrink-0" />
                      <span className="truncate">{item.storageLocation}</span>
                    </p>

                    {item.rentalPricePerUnit > 0 && (
                      <p className="text-xs font-extrabold text-amber-600 dark:text-amber-400 flex items-center gap-1">
                        <DollarSign className="w-3.5 h-3.5" />
                        <span>${item.rentalPricePerUnit} / unit rental</span>
                      </p>
                    )}

                    {/* Quantity breakdown */}
                    <div className="p-2.5 bg-slate-50 dark:bg-slate-800/60 rounded-xl grid grid-cols-3 gap-1 text-center border border-slate-100 dark:border-slate-800 mt-3">
                      <div>
                        <span className="text-[10px] text-slate-400 font-medium block">{t('quantity')}</span>
                        <span className="text-xs font-bold text-slate-900 dark:text-white">{item.quantity}</span>
                      </div>
                      <div>
                        <span className="text-[10px] text-slate-400 font-medium block">{t('availableQuantity')}</span>
                        <span className="text-xs font-extrabold text-emerald-600 dark:text-emerald-400">{item.availableQuantity}</span>
                      </div>
                      <div>
                        <span className="text-[10px] text-slate-400 font-medium block">{t('reservedQuantity')}</span>
                        <span className="text-xs font-bold text-amber-600 dark:text-amber-400">{item.reservedQuantity}</span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Footer Controls */}
                <div className="p-4 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between">
                  <span className={`px-2 py-0.5 text-[10px] font-bold rounded-md uppercase ${getConditionBadge(item.condition)}`}>
                    {item.condition.replace('_', ' ')}
                  </span>

                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => {
                        setEditingItem(item);
                        setIsModalOpen(true);
                      }}
                      className="p-1.5 text-slate-500 hover:text-amber-600 hover:bg-amber-50 dark:hover:bg-amber-950/30 rounded-lg transition-colors cursor-pointer"
                      title={t('edit')}
                    >
                      <Edit className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => handleDelete(item.id)}
                      className="p-1.5 text-slate-500 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/30 rounded-lg transition-colors cursor-pointer"
                      title={t('delete')}
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Modal */}
      {isModalOpen && (
        <InventoryModal
          isOpen={isModalOpen}
          initialItem={editingItem}
          onClose={() => {
            setIsModalOpen(false);
            setEditingItem(null);
          }}
        />
      )}
    </div>
  );
};

