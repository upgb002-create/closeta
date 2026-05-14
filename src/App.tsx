import React, { useState, useEffect, useRef, useCallback } from 'react';
import { 
  Plus, 
  Trash2, 
  X, 
  Vibrate, 
  Settings, 
  Info, 
  Image as ImageIcon,
  Check,
  ChevronLeft,
  Smartphone,
  Camera,
  Sparkles,
  Loader2,
  RefreshCw,
  Moon,
  Sun,
  Monitor,
  Palette
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { GoogleGenAI, Type } from "@google/genai";

// --- AI Initialization ---
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

// --- Types ---
type Material = 'Silk' | 'Knit' | 'Denim' | 'Leather' | 'Fur' | 'Cotton' | 'Linen';
type ThemeMode = 'basic' | 'highContrast';

interface Outfit {
  id: string;
  name: string;
  description: string;
  material: Material;
  image: string;
  createdAt: number;
}

const MATERIAL_LABELS: Record<Material, string> = {
  Silk: '실크',
  Knit: '니트',
  Denim: '데님',
  Leather: '가죽',
  Fur: '퍼/털',
  Cotton: '면',
  Linen: '린넨'
};

const HAPTIC_PATTERNS: Record<Material, number[]> = {
  Silk: [10, 80, 10],
  Knit: [30, 40, 30, 40, 30],
  Denim: [80],
  Leather: [100, 50, 100],
  Fur: [15, 20, 15, 20, 15],
  Cotton: [40],
  Linen: [25, 30, 50]
};

// --- Utilities ---
const getLocalStorage = <T,>(key: string, defaultValue: T): T => {
  const stored = localStorage.getItem(key);
  if (!stored) return defaultValue;
  try {
    return JSON.parse(stored);
  } catch {
    return defaultValue;
  }
};

const setLocalStorage = <T,>(key: string, value: T): void => {
  localStorage.setItem(key, JSON.stringify(value));
};

export default function App() {
  const [outfits, setOutfits] = useState<Outfit[]>(() => getLocalStorage<Outfit[]>('touch-closet-outfits', []));
  const [isHapticEnabled, setIsHapticEnabled] = useState<boolean>(() => getLocalStorage<boolean>('touch-closet-haptic-enabled', true));
  const [themeMode, setThemeMode] = useState<ThemeMode>(() => getLocalStorage<ThemeMode>('touch-closet-theme-mode', 'basic'));
  const [isUploadOpen, setIsUploadOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isCameraOpen, setIsCameraOpen] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [selectedOutfit, setSelectedOutfit] = useState<Outfit | null>(null);
  const [vibrateSupported, setVibrateSupported] = useState<boolean>(false);

  // Form State
  const [newName, setNewName] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [newMaterial, setNewMaterial] = useState<Material>('Cotton');
  const [newImage, setNewImage] = useState<string | null>(null);

  const vibrationTimerRef = useRef<NodeJS.Timeout | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    setVibrateSupported('vibrate' in navigator);
  }, []);

  useEffect(() => {
    setLocalStorage('touch-closet-outfits', outfits);
  }, [outfits]);

  useEffect(() => {
    setLocalStorage('touch-closet-haptic-enabled', isHapticEnabled);
  }, [isHapticEnabled]);

  useEffect(() => {
    setLocalStorage('touch-closet-theme-mode', themeMode);
  }, [themeMode]);

  const handleVibrate = useCallback((material: Material) => {
    if (!isHapticEnabled || !vibrateSupported) return;
    
    // Throttle vibration
    if (vibrationTimerRef.current) return;

    const pattern = HAPTIC_PATTERNS[material];
    navigator.vibrate(pattern);

    vibrationTimerRef.current = setTimeout(() => {
      vibrationTimerRef.current = null;
    }, 150);
  }, [isHapticEnabled, vibrateSupported]);

  const stopVibrate = () => {
    if (vibrationTimerRef.current) {
      clearTimeout(vibrationTimerRef.current);
      vibrationTimerRef.current = null;
    }
    navigator.vibrate(0);
  };

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        setNewImage(reader.result as string);
        analyzeImage(reader.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  const startCamera = async () => {
    setIsCameraOpen(true);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ 
        video: { facingMode: 'environment' } 
      });
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }
    } catch (err) {
      console.error("Camera error:", err);
      alert("카메라를 시작할 수 없습니다. 권한을 확인해주세요.");
      setIsCameraOpen(false);
    }
  };

  const stopCamera = () => {
    if (videoRef.current && videoRef.current.srcObject) {
      const stream = videoRef.current.srcObject as MediaStream;
      stream.getTracks().forEach(track => track.stop());
      videoRef.current.srcObject = null;
    }
    setIsCameraOpen(false);
  };

  const takePhoto = () => {
    if (videoRef.current && canvasRef.current) {
      const video = videoRef.current;
      const canvas = canvasRef.current;
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        const dataUrl = canvas.toDataURL('image/jpeg');
        setNewImage(dataUrl);
        stopCamera();
        analyzeImage(dataUrl);
      }
    }
  };

  const analyzeImage = async (base64Image: string) => {
    if (!base64Image) return;
    
    setIsAnalyzing(true);
    try {
      // Remove data prefix
      const base64Data = base64Image.split(',')[1];
      
      const prompt = `Analyze this clothing image. Provide:
1. A concise, clear name for the item in Korean.
2. A detailed description in Korean (color, style, features) for a visually impaired user.
3. Classify the primary material into exactly one of these: Silk, Knit, Denim, Leather, Fur, Cotton, Linen.

Return ONLY a JSON object.`;

      const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: [
          {
            parts: [
              { text: prompt },
              { inlineData: { data: base64Data, mimeType: "image/jpeg" } }
            ]
          }
        ],
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              name: { type: Type.STRING },
              description: { type: Type.STRING },
              material: { 
                type: Type.STRING,
                enum: ['Silk', 'Knit', 'Denim', 'Leather', 'Fur', 'Cotton', 'Linen']
              },
            },
            required: ['name', 'description', 'material']
          }
        }
      });

      const result = JSON.parse(response.text);
      setNewName(result.name);
      setNewDesc(result.description);
      setNewMaterial(result.material as Material);
      
      // Haptic feedback once analysis is done
      handleVibrate(result.material as Material);
    } catch (error) {
      console.error("AI Analysis failed:", error);
    } finally {
      setIsAnalyzing(false);
    }
  };

  const saveOutfit = () => {
    if (!newName || !newImage) {
      alert('옷 이름과 사진은 필수입니다.');
      return;
    }

    const outfit: Outfit = {
      id: Math.random().toString(36).substring(2, 11),
      name: newName,
      description: newDesc,
      material: newMaterial,
      image: newImage,
      createdAt: Date.now()
    };

    setOutfits(prev => [outfit, ...prev]);
    setIsUploadOpen(false);
    resetForm();
  };

  const deleteOutfit = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (confirm('이 옷을 삭제하시겠습니까?')) {
      setOutfits(prev => prev.filter(o => o.id !== id));
    }
  };

  const resetForm = () => {
    setNewName('');
    setNewDesc('');
    setNewMaterial('Cotton');
    setNewImage(null);
  };

  // --- Theme Styles ---
  const isHC = themeMode === 'highContrast';
  
  const themeClasses = {
    bg: isHC ? 'bg-[#0A261F]' : 'bg-[#F3F0F8]',
    text: isHC ? 'text-[#FFD1DC]' : 'text-[#2D2438]',
    headerBg: isHC ? 'bg-[#0C2D27]/90' : 'bg-white/80',
    headerBorder: isHC ? 'border-[#FFD1DC]/30' : 'border-[#E0D7EE]',
    cardBg: isHC ? 'bg-[#0C2D27]' : 'bg-white',
    cardBorder: isHC ? 'border-[#FFD1DC]/40' : 'border-[#E0D7EE]/50',
    accent: isHC ? 'bg-[#FFD1DC] text-[#0A261F]' : 'bg-[#6D4C9B] text-white',
    accentGhost: isHC ? 'bg-[#FFD1DC]/10 text-[#FFD1DC] border-[#FFD1DC]/40' : 'bg-[#6D4C9B]/5 text-[#6D4C9B] border-[#E0D7EE]',
    buttonPrimary: isHC ? 'bg-[#FFD1DC] text-[#0A261F]' : 'bg-[#6D4C9B] text-white',
    buttonSecondary: isHC ? 'bg-[#0A261F] text-[#FFD1DC] border-[#FFD1DC]' : 'bg-[#F3F0F8] text-[#6D4C9B]',
    inputBg: isHC ? 'bg-[#0A261F] border-[#FFD1DC]' : 'bg-[#F3F0F8] border-transparent',
  };

  return (
    <div className={`min-h-screen ${themeClasses.bg} ${themeClasses.text} font-sans pb-20 transition-colors duration-300`}>
      {/* Header */}
      <header className={`sticky top-0 z-30 ${themeClasses.headerBg} backdrop-blur-md border-b ${themeClasses.headerBorder} px-6 py-4 shadow-sm`}>
        <div className="max-w-2xl mx-auto flex items-center justify-between">
          <h1 className={`text-2xl font-black tracking-tighter ${isHC ? 'text-[#FFD1DC]' : 'text-[#6D4C9B]'}`}>SYNK</h1>
          <div className="flex items-center gap-3">
            <button 
              onClick={() => setIsSettingsOpen(true)}
              className={`p-2.5 rounded-full transition-all ${isHC ? 'bg-[#FFD1DC] text-[#0A261F]' : 'bg-[#6D4C9B] text-white shadow-lg'}`}
              aria-label="설정 열기"
            >
              <Settings size={22} />
            </button>
          </div>
        </div>
      </header>

      {/* Hero / Description */}
      <section className="max-w-2xl mx-auto px-6 py-8">
        <div className={`${themeClasses.cardBg} rounded-3xl p-6 shadow-xl border-2 ${isHC ? 'border-[#FFD1DC]' : 'border-transparent'} mb-8`}>
          <p className="text-lg font-bold leading-relaxed mb-4">
            SYNK는 옷의 사진과 소재 정보를 저장하고, 사진 위를 손가락으로 문질러 소재별 진동 패턴을 체험할 수 있는 패션 보조 앱입니다.
          </p>
          <div className={`flex items-start gap-2 p-3 ${isHC ? 'bg-[#FFD1DC]/10 border-[#FFD1DC]/30 text-[#FFD1DC]' : 'bg-amber-50 border-amber-100 text-amber-800'} rounded-xl border italic text-xs`}>
            <Info size={16} className="shrink-0 mt-0.5" />
            <p>
              본 프로토타입은 실제 촉감을 완전히 재현하는 것이 아니라, 소재 정보를 진동 패턴으로 보조 전달하는 실험용 웹앱입니다. 기기와 브라우저에 따라 햅틱 기능이 작동하지 않을 수 있습니다.
            </p>
          </div>
          {!vibrateSupported && (
            <div className={`mt-4 flex items-center gap-2 p-3 ${isHC ? 'bg-rose-900 border-rose-500 text-rose-100' : 'bg-rose-50 text-rose-700 border-rose-100'} rounded-xl border text-sm font-bold`}>
              <Smartphone size={18} />
              <p>이 기기에서는 햅틱(진동)을 지원하지 않습니다. 햅틱은 Android 모바일 환경에 최적화되어 있습니다.</p>
            </div>
          )}
        </div>

        {/* Action Bar */}
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xl font-black flex items-center gap-2">
            내 옷장 <span className={`${isHC ? 'text-[#FFD1DC]/60' : 'text-[#6D4C9B]/60'} text-base font-bold`}>({outfits.length})</span>
          </h2>
          <button 
            onClick={() => setIsUploadOpen(true)}
            className={`flex items-center gap-2 ${themeClasses.buttonPrimary} px-5 py-2.5 rounded-full font-black transition-transform active:scale-95 shadow-lg shadow-black/20`}
            aria-label="새 옷 추가"
          >
            <Plus size={20} />
            추가하기
          </button>
        </div>

        {/* Pinterest-style Grid */}
        <div className="columns-2 gap-4 sm:columns-3">
          <AnimatePresence>
            {outfits.map((outfit) => (
              <motion.div
                key={outfit.id}
                layoutId={outfit.id}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.9 }}
                className="break-inside-avoid mb-4 group cursor-pointer"
                onClick={() => setSelectedOutfit(outfit)}
              >
                <div className={`${themeClasses.cardBg} rounded-2xl overflow-hidden shadow-md hover:shadow-xl transition-shadow border-2 ${themeClasses.cardBorder}`}>
                  <div className="relative aspect-[3/4] overflow-hidden bg-gray-100/10">
                    <img 
                      src={outfit.image} 
                      alt={outfit.description || outfit.name} 
                      className="w-full h-full object-cover transition-transform group-hover:scale-105"
                    />
                    <div className="absolute top-2 right-2 flex gap-1">
                      <button
                        onClick={(e) => deleteOutfit(outfit.id, e)}
                        className={`p-2 backdrop-blur-sm rounded-full transition-colors shadow-sm ${isHC ? 'bg-[#FFD1DC] text-[#0A261F]' : 'bg-white/90 text-rose-500'}`}
                        aria-label={`${outfit.name} 삭제`}
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </div>
                  <div className="p-4">
                    <h3 className={`font-black text-base mb-1 truncate ${isHC ? 'text-[#FFD1DC]' : 'text-[#2D2438]'}`}>{outfit.name}</h3>
                    {outfit.description && (
                      <p className={`text-xs line-clamp-2 mb-2 leading-relaxed ${isHC ? 'text-[#FFD1DC]/80 font-bold' : 'text-[#6D4C9B]/70'}`}>
                        {outfit.description}
                      </p>
                    )}
                    <span className={`inline-block px-2.5 py-1 text-[10px] font-black rounded-md uppercase tracking-wider ${isHC ? 'bg-[#FFD1DC] text-[#0A261F]' : 'bg-[#6D4C9B]/10 text-[#6D4C9B]'}`}>
                      {MATERIAL_LABELS[outfit.material]}
                    </span>
                  </div>
                </div>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>

        {outfits.length === 0 && (
          <div className={`flex flex-col items-center justify-center py-20 ${isHC ? 'text-[#FFD1DC]/40' : 'text-[#6D4C9B]/40'}`}>
            <div className={`p-6 ${themeClasses.cardBg} rounded-full mb-4 shadow-inner border-2 ${themeClasses.cardBorder}`}>
              <Plus size={48} />
            </div>
            <p className="text-lg font-black">아직 저장된 옷이 없습니다.</p>
            <p className="text-sm font-bold opacity-60">추가하기 버튼을 눌러 첫 번째 옷을 등록해보세요.</p>
          </div>
        )}
      </section>

      {/* Upload Modal */}
      <AnimatePresence>
        {isUploadOpen && (
          <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className={`absolute inset-0 ${isHC ? 'bg-black/80' : 'bg-[#2D2438]/60'} backdrop-blur-sm`}
              onClick={() => setIsUploadOpen(false)}
            />
            <motion.div 
              initial={{ y: "100%" }}
              animate={{ y: 0 }}
              exit={{ y: "100%" }}
              className={`relative w-full max-w-lg ${themeClasses.cardBg} rounded-t-[2.5rem] sm:rounded-[2.5rem] p-8 shadow-2xl flex flex-col max-h-[95vh] overflow-y-auto border-t-2 sm:border-2 ${themeClasses.cardBorder}`}
            >
              <div className="flex items-center justify-between mb-8">
                <h2 className="text-2xl font-black">새 옷 저장하기</h2>
                <button 
                  onClick={() => setIsUploadOpen(false)}
                  className={`p-2 rounded-full transition-colors ${isHC ? 'hover:bg-[#FFD1DC]/20' : 'hover:bg-gray-100'}`}
                  aria-label="닫기"
                >
                  <X />
                </button>
              </div>

              <div className="space-y-6">
                {/* Image Upload */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <label className={`block text-sm font-black ${isHC ? 'text-[#FFD1DC]' : 'text-[#6D4C9B]'}`}>사진 등록</label>
                    {isAnalyzing && (
                      <div 
                        className={`flex items-center gap-2 animate-pulse ${isHC ? 'text-[#FFD1DC]' : 'text-[#6D4C9B]'}`}
                        role="status"
                        aria-live="polite"
                      >
                        <Loader2 size={14} className="animate-spin" />
                        <span className="text-[10px] font-bold">AI가 사진을 분석하고 있습니다...</span>
                      </div>
                    )}
                  </div>
                  <div className={`relative aspect-video rounded-2xl ${themeClasses.inputBg} border-2 border-dashed ${isHC ? 'border-[#FFD1DC]' : 'border-[#E0D7EE]'} overflow-hidden flex items-center justify-center group`}>
                    {isCameraOpen ? (
                      <div className="absolute inset-0 z-10 flex flex-col items-center bg-black">
                        <video 
                          ref={videoRef} 
                          autoPlay 
                          playsInline 
                          className="w-full h-full object-cover"
                        />
                        <div className="absolute bottom-4 flex items-center gap-4">
                          <button 
                            onClick={takePhoto}
                            className={`w-16 h-16 rounded-full bg-white border-4 ${isHC ? 'border-[#FFD1DC]' : 'border-[#6D4C9B]'} shadow-lg flex items-center justify-center transition-transform active:scale-90`}
                            aria-label="사진 촬영"
                          >
                            <div className={`w-10 h-10 rounded-full ${isHC ? 'bg-[#FFD1DC]' : 'bg-[#6D4C9B]'}`} />
                          </button>
                          <button 
                            onClick={stopCamera}
                            className="p-3 bg-white/20 backdrop-blur rounded-full text-white"
                            aria-label="카메라 끄기"
                          >
                            <X size={24} />
                          </button>
                        </div>
                      </div>
                    ) : null}
                    
                    {newImage ? (
                      <>
                        <img src={newImage} alt="Preview" className="w-full h-full object-cover" />
                        <div className="absolute inset-0 bg-black/40 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                           <button 
                             onClick={() => analyzeImage(newImage)}
                             className={`flex items-center gap-2 px-4 py-2 rounded-full font-black shadow-lg text-sm ${themeClasses.buttonPrimary}`}
                           >
                             <Sparkles size={16} />
                             다시 분석하기
                           </button>
                        </div>
                        <button 
                          onClick={() => {
                            setNewImage(null);
                            resetForm();
                          }}
                          className={`absolute top-2 right-2 p-2 rounded-full shadow-sm ${isHC ? 'bg-[#FFD1DC] text-[#0A261F]' : 'bg-white/80 text-rose-500'}`}
                          aria-label="사진 삭제"
                        >
                          <X size={16} />
                        </button>
                      </>
                    ) : (
                      <div className={`w-full h-full grid grid-cols-1 divide-y ${isHC ? 'divide-[#FFD1DC]/40' : 'divide-[#E0D7EE]'}`}>
                        <button 
                          onClick={startCamera}
                          className={`flex flex-col items-center justify-center gap-2 p-4 transition-colors ${isHC ? 'hover:bg-[#FFD1DC]/20' : 'hover:bg-[#6D4C9B]/5'}`}
                        >
                          <Camera size={38} className={isHC ? 'text-[#FFD1DC]' : 'text-[#6D4C9B]'} />
                          <span className="font-black">카메라로 촬영</span>
                        </button>
                        <label className={`flex flex-col items-center justify-center gap-2 p-4 cursor-pointer transition-colors ${isHC ? 'hover:bg-[#FFD1DC]/20' : 'hover:bg-[#6D4C9B]/5'}`}>
                          <ImageIcon size={34} className={isHC ? 'text-[#FFD1DC]/60' : 'text-[#6D4C9B]/40'} />
                          <div className="text-center">
                            <p className="font-black">갤러리에서 선택</p>
                            <p className={`text-[10px] italic font-bold ${isHC ? 'text-[#FFD1DC]/60' : 'text-[#6D4C9B]/60'}`}>AI 자동 분석</p>
                          </div>
                          <input type="file" accept="image/*" className="hidden" onChange={handleImageUpload} />
                        </label>
                      </div>
                    )}
                  </div>
                  <canvas ref={canvasRef} className="hidden" />
                </div>

                {/* Name */}
                <div>
                  <label htmlFor="outfit-name" className={`block text-sm font-black mb-2 uppercase tracking-wide ${isHC ? 'text-[#FFD1DC]' : 'text-[#6D4C9B]'}`}>
                    옷 이름
                  </label>
                  <input 
                    id="outfit-name"
                    type="text" 
                    value={newName} 
                    onChange={e => setNewName(e.target.value)}
                    placeholder="예: 최애 보라색 셔츠"
                    className={`w-full ${themeClasses.inputBg} border-2 ${isHC ? 'border-[#FFD1DC] text-[#FFD1DC] placeholder:text-[#FFD1DC]/40' : 'border-transparent focus:border-[#6D4C9B] focus:ring-2 focus:ring-[#6D4C9B]/20 placeholder:text-[#6D4C9B]/40'} rounded-xl px-4 py-3 outline-none transition-all font-bold`}
                  />
                </div>

                {/* Description */}
                <div>
                  <label htmlFor="outfit-desc" className={`block text-sm font-black mb-2 uppercase tracking-wide ${isHC ? 'text-[#FFD1DC]' : 'text-[#6D4C9B]'}`}>
                    설명 (색상, 디자인 등)
                  </label>
                  <textarea 
                    id="outfit-desc"
                    value={newDesc} 
                    onChange={e => setNewDesc(e.target.value)}
                    placeholder="예: 은은한 연보라색에 흰색 단추가 달린 긴팔 셔츠."
                    rows={3}
                    className={`w-full ${themeClasses.inputBg} border-2 ${isHC ? 'border-[#FFD1DC] text-[#FFD1DC] placeholder:text-[#FFD1DC]/40' : 'border-transparent focus:border-[#6D4C9B] focus:ring-2 focus:ring-[#6D4C9B]/20 placeholder:text-[#6D4C9B]/40'} rounded-xl px-4 py-3 outline-none transition-all resize-none font-bold`}
                  />
                </div>

                {/* Material Select */}
                <div>
                  <label className={`block text-sm font-black mb-4 uppercase tracking-wide ${isHC ? 'text-[#FFD1DC]' : 'text-[#6D4C9B]'}`}>
                    소재 선택
                  </label>
                  <div className="grid grid-cols-2 xs:grid-cols-3 gap-2">
                    {(Object.keys(MATERIAL_LABELS) as Material[]).map((mat) => (
                      <button
                        key={mat}
                        onClick={() => {
                          setNewMaterial(mat);
                          handleVibrate(mat);
                        }}
                        className={`px-3 py-3 rounded-xl border-2 text-sm font-black transition-all flex items-center justify-center gap-2 ${
                          newMaterial === mat 
                            ? `${themeClasses.buttonPrimary} ${isHC ? 'border-primary' : 'border-[#6D4C9B]'}` 
                            : `${isHC ? 'bg-[#0A261F] border-[#FFD1DC] text-[#FFD1DC]' : 'bg-white border-[#E0D7EE] text-[#6D4C9B] hover:border-[#6D4C9B]'}`
                        }`}
                      >
                        {newMaterial === mat && <Check size={14} />}
                        {MATERIAL_LABELS[mat]}
                      </button>
                    ))}
                  </div>
                </div>

                <button 
                  onClick={saveOutfit}
                  className={`w-full ${themeClasses.buttonPrimary} py-4 rounded-2xl font-black text-xl transition-transform active:scale-95 shadow-xl shadow-black/20 mt-4 disabled:opacity-50 flex items-center justify-center gap-3 border-2 ${isHC ? 'border-[#FFD1DC]' : 'border-transparent'}`}
                  disabled={!newName || !newImage || isAnalyzing}
                  aria-label={isAnalyzing ? "AI 분석 중입니다. 잠시만 기다려주세요." : "옷 정보를 옷장에 저장합니다."}
                >
                  {isAnalyzing ? (
                    <>
                      <Loader2 size={24} className="animate-spin" aria-hidden="true" />
                      AI 분석 중...
                    </>
                  ) : (
                    <>저장하기</>
                  )}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Settings Modal */}
      <AnimatePresence>
        {isSettingsOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-6">
            <motion.div 
               initial={{ opacity: 0 }}
               animate={{ opacity: 1 }}
               exit={{ opacity: 0 }}
               className={`absolute inset-0 ${isHC ? 'bg-black/80' : 'bg-[#2D2438]/60'} backdrop-blur-sm`}
               onClick={() => setIsSettingsOpen(false)}
            />
            <motion.div
               initial={{ scale: 0.9, opacity: 0 }}
               animate={{ scale: 1, opacity: 1 }}
               exit={{ scale: 0.9, opacity: 0 }}
               className={`relative w-full max-w-sm ${themeClasses.cardBg} rounded-[2rem] p-8 shadow-2xl border-2 ${themeClasses.cardBorder}`}
            >
              <div className="flex items-center justify-between mb-8">
                <h2 className="text-2xl font-black">설정</h2>
                <button 
                  onClick={() => setIsSettingsOpen(false)}
                  className={`p-2 rounded-full transition-colors ${isHC ? 'hover:bg-[#FFD1DC]/20' : 'hover:bg-gray-100'}`}
                >
                  <X />
                </button>
              </div>

              <div className="space-y-8">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className={`p-2 rounded-lg ${isHC ? 'bg-[#FFD1DC] text-[#0A261F]' : 'bg-[#6D4C9B]/10 text-[#6D4C9B]'}`}>
                      <Vibrate size={20} />
                    </div>
                    <div>
                      <p className="font-black text-base">진동 설정</p>
                      <p className={`text-xs font-bold opacity-60`}>소재 햅틱 피드백</p>
                    </div>
                  </div>
                  <button 
                    onClick={() => setIsHapticEnabled(!isHapticEnabled)}
                    className={`w-14 h-8 rounded-full relative transition-colors ${isHapticEnabled ? (isHC ? 'bg-[#FFD1DC]' : 'bg-[#6D4C9B]') : (isHC ? 'bg-[#FFD1DC]/20' : 'bg-gray-200')}`}
                  >
                    <motion.div 
                      animate={{ x: isHapticEnabled ? 28 : 4 }}
                      className={`w-6 h-6 rounded-full absolute top-1 ${isHapticEnabled ? (isHC ? 'bg-[#0A261F]' : 'bg-white') : (isHC ? 'bg-[#FFD1DC]' : 'bg-white')} shadow-sm`}
                    />
                  </button>
                </div>

                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className={`p-2 rounded-lg ${isHC ? 'bg-[#FFD1DC] text-[#0A261F]' : 'bg-[#6D4C9B]/10 text-[#6D4C9B]'}`}>
                      <Palette size={20} />
                    </div>
                    <div>
                      <p className="font-black text-base">화면 모드</p>
                      <p className={`text-xs font-bold opacity-60`}>저시력자 보조 테마</p>
                    </div>
                  </div>
                  <div className="flex bg-gray-100/50 p-1 rounded-xl">
                    <button 
                      onClick={() => setThemeMode('basic')}
                      className={`px-3 py-1.5 rounded-lg text-xs font-black transition-all ${themeMode === 'basic' ? 'bg-[#6D4C9B] text-white shadow-sm' : 'text-gray-400'}`}
                    >
                      기본
                    </button>
                    <button 
                      onClick={() => setThemeMode('highContrast')}
                      className={`px-3 py-1.5 rounded-lg text-xs font-black transition-all ${themeMode === 'highContrast' ? 'bg-[#FFD1DC] text-[#0A261F] shadow-sm' : 'text-gray-400'}`}
                    >
                      고대비
                    </button>
                  </div>
                </div>
              </div>

              <button 
                onClick={() => setIsSettingsOpen(false)}
                className={`w-full mt-10 ${themeClasses.buttonPrimary} py-3.5 rounded-xl font-black text-base border-2 ${isHC ? 'border-[#FFD1DC]' : 'border-transparent'}`}
              >
                완료
              </button>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Detail Modal / Haptic Interaction */}
      <AnimatePresence>
        {selectedOutfit && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-0 sm:p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className={`absolute inset-0 ${isHC ? 'bg-black/90' : 'bg-[#2D2438]/90'} backdrop-blur-md`}
              onClick={() => setSelectedOutfit(null)}
            />
            <motion.div 
              layoutId={selectedOutfit.id}
              className={`relative w-full max-w-2xl ${themeClasses.cardBg} sm:rounded-[2.5rem] overflow-hidden flex flex-col max-h-screen sm:max-h-[95vh] border-2 ${themeClasses.cardBorder}`}
            >
              {/* Interaction Canvas */}
              <div 
                className="relative flex-1 bg-black overflow-hidden group touch-none select-none"
                onPointerDown={() => handleVibrate(selectedOutfit.material)}
                onPointerMove={() => handleVibrate(selectedOutfit.material)}
                onPointerUp={stopVibrate}
                onPointerLeave={stopVibrate}
                onPointerCancel={stopVibrate}
              >
                <img 
                  src={selectedOutfit.image} 
                  alt={selectedOutfit.name} 
                  className="w-full h-full object-contain pointer-events-none"
                />
                
                {/* Guideline Overlay */}
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none opacity-0 group-active:opacity-100 transition-opacity">
                  <div className={`backdrop-blur text-white px-4 py-2 rounded-full border border-white/20 text-sm font-bold ${isHC ? 'bg-[#FFD1DC]/20' : 'bg-white/10'}`}>
                    진동 감지 중...
                  </div>
                </div>

                <button 
                  onClick={() => setSelectedOutfit(null)}
                  className={`absolute top-6 left-6 p-2 backdrop-blur-md rounded-full transition-colors border ${isHC ? 'bg-[#FFD1DC] text-[#0A261F] border-white/20' : 'bg-black/40 text-white border-white/10'}`}
                  aria-label="돌아가기"
                >
                  <ChevronLeft size={28} />
                </button>
              </div>

              {/* Info Area */}
              <div className={`p-8 ${themeClasses.cardBg} border-t-2 ${themeClasses.cardBorder}`}>
                <div className="flex items-start justify-between gap-4 mb-4">
                  <div className="flex-1">
                    <h2 className="text-2xl font-black mb-1">{selectedOutfit.name}</h2>
                    <div className="flex items-center gap-2">
                      <span className={`px-2 py-0.5 text-xs font-black rounded uppercase ${themeClasses.accent}`}>
                        {MATERIAL_LABELS[selectedOutfit.material]}
                      </span>
                      <span className={`text-xs font-bold tracking-tight opacity-70`}>
                        {new Date(selectedOutfit.createdAt).toLocaleDateString()} 저장됨
                      </span>
                    </div>
                  </div>
                  <div className={`flex items-center gap-2 px-4 py-2 rounded-xl border-2 transition-all ${isHapticEnabled ? (isHC ? 'border-[#FFD1DC] bg-[#FFD1DC]/10 text-[#FFD1DC]' : 'border-[#6D4C9B] bg-[#6D4C9B]/5 text-[#6D4C9B]') : 'border-gray-200 bg-gray-50 text-gray-400'}`}>
                    <Vibrate size={18} className={isHapticEnabled ? 'animate-pulse' : ''} />
                    <span className="text-xs font-black uppercase tracking-widest">{isHapticEnabled ? 'ON' : 'OFF'}</span>
                  </div>
                </div>

                <div className={`${isHC ? 'bg-[#0A261F] border-2 border-[#FFD1DC]/40' : 'bg-[#F3F0F8]'} p-4 rounded-2xl mb-6`}>
                  <p className="text-base leading-relaxed font-bold">
                    {selectedOutfit.description || "등록된 설명이 없습니다."}
                  </p>
                </div>
                
                <div className={`p-4 rounded-2xl flex items-center gap-3 border ${isHC ? 'bg-[#FFD1DC]/10 border-[#FFD1DC]/40 text-[#FFD1DC]' : 'bg-purple-50 border-purple-100 text-purple-900'}`}>
                  <div className={`shrink-0 w-10 h-10 flex items-center justify-center rounded-full shadow-sm ${isHC ? 'bg-[#FFD1DC] text-[#0A261F]' : 'bg-white text-purple-600'}`}>
                    <Vibrate size={20} />
                  </div>
                  <div className="flex-1">
                    <p className="text-sm font-black leading-tight mb-1">
                      사진 위를 손가락으로 문질러 소재 햅틱을 느껴보세요.
                    </p>
                    <p className={`text-[10px] font-bold opacity-70`}>
                      iPhone/Safari 환경에서는 햅틱 기능이 제한될 수 있습니다.
                    </p>
                  </div>
                </div>

                <button 
                  onClick={() => setSelectedOutfit(null)}
                  className={`w-full mt-6 ${isHC ? 'bg-[#FFD1DC] text-[#0A261F]' : 'bg-[#2D2438] text-white'} py-4 rounded-xl font-black text-lg transition-colors border-2 ${isHC ? 'border-[#FFD1DC]' : 'border-transparent'}`}
                >
                  닫기
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
