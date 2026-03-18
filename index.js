import React, { useState, useRef, useEffect } from 'react';
import { Camera, UserPlus, History, Bell, ShieldCheck, Video, User, CheckCircle2, AlertCircle } from 'lucide-react';

export default function App() {
  const [activeTab, setActiveTab] = useState('camera');
  const [students, setStudents] = useState([]);
  const [logs, setLogs] = useState([]);
  const [toast, setToast] = useState(null);

  // Estados para o Cadastro
  const [newName, setNewName] = useState('');
  const [newParentPhone, setNewParentPhone] = useState('');
  const [newPhoto, setNewPhoto] = useState(null);
  const registerVideoRef = useRef(null);
  const monitorVideoRef = useRef(null);

  // Simulação de "Banco de Dados" inicial
  useEffect(() => {
    setStudents([
      { id: '1', name: 'Maria Eduarda', parentPhone: '(11) 99999-9999', photo: 'https://api.dicebear.com/7.x/avataaars/svg?seed=Maria' },
      { id: '2', name: 'João Pedro', parentPhone: '(11) 98888-8888', photo: 'https://api.dicebear.com/7.x/avataaars/svg?seed=Joao' }
    ]);
  }, []);

  // Inicializar câmera dependendo da aba
  useEffect(() => {
    let stream = null;
    const startCamera = async (videoRef) => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: true });
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
        }
      } catch (err) {
        console.error("Erro ao acessar câmera:", err);
      }
    };

    if (activeTab === 'register' && registerVideoRef.current) startCamera(registerVideoRef);
    if (activeTab === 'camera' && monitorVideoRef.current) startCamera(monitorVideoRef);

    return () => {
      if (stream) stream.getTracks().forEach(track => track.stop());
    };
  }, [activeTab]);

  const showToast = (message, type = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 4000);
  };

  const handleCapturePhoto = () => {
    const video = registerVideoRef.current;
    if (!video) return;
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext('2d').drawImage(video, 0, 0);
    setNewPhoto(canvas.toDataURL('image/jpeg'));
  };

  const handleRegisterStudent = (e) => {
    e.preventDefault();
    if (!newName || !newParentPhone || !newPhoto) {
      showToast('Preencha todos os campos e tire a foto!', 'error');
      return;
    }
    
    const newStudent = {
      id: Date.now().toString(),
      name: newName,
      parentPhone: newParentPhone,
      photo: newPhoto
    };

    setStudents([...students, newStudent]);
    setNewName('');
    setNewParentPhone('');
    setNewPhoto(null);
    showToast('Aluno cadastrado com sucesso!');
    setActiveTab('camera');
  };

  // Simula o reconhecimento da câmera e envio de mensagem
  const simulateRecognition = (student) => {
    const isEntry = Math.random() > 0.5; // Simula entrada ou saída aleatoriamente
    const type = isEntry ? 'Entrada' : 'Saída';
    
    const newLog = {
      id: Date.now().toString(),
      studentId: student.id,
      studentName: student.name,
      time: new Date().toLocaleTimeString(),
      type: type
    };

    setLogs([newLog, ...logs]);
    
    // Simula a mensagem do WhatsApp/SMS
    const message = `🔔 *Escola Guardian*\nSua filha(o) ${student.name} acabou de registrar ${type.toLowerCase()} na escola às ${newLog.time}.`;
    
    showToast(`Mensagem enviada para ${student.parentPhone}:\n"${message}"`);
  };

  return (
    <div className="min-h-screen bg-slate-100 flex text-slate-800 font-sans">
      
      {/* Sidebar Navigation */}
      <aside className="w-64 bg-slate-900 text-slate-300 flex flex-col shadow-xl z-10">
        <div className="p-6 flex items-center gap-3 text-white border-b border-slate-800">
          <ShieldCheck className="text-blue-500" size={32} />
          <h1 className="text-xl font-bold tracking-tight">Guardian<span className="text-blue-500">AI</span></h1>
        </div>
        
        <nav className="flex-1 p-4 space-y-2">
          <button 
            onClick={() => setActiveTab('camera')}
            className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg transition-colors ${activeTab === 'camera' ? 'bg-blue-600 text-white' : 'hover:bg-slate-800'}`}
          >
            <Video size={20} />
            Monitoramento Ao Vivo
          </button>
          
          <button 
            onClick={() => setActiveTab('register')}
            className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg transition-colors ${activeTab === 'register' ? 'bg-blue-600 text-white' : 'hover:bg-slate-800'}`}
          >
            <UserPlus size={20} />
            Cadastrar Aluno
          </button>
          
          <button 
            onClick={() => setActiveTab('logs')}
            className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg transition-colors ${activeTab === 'logs' ? 'bg-blue-600 text-white' : 'hover:bg-slate-800'}`}
          >
            <History size={20} />
            Histórico & Logs
          </button>
        </nav>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col relative overflow-hidden">
        
        {/* Header */}
        <header className="bg-white p-6 shadow-sm flex justify-between items-center z-0">
          <h2 className="text-2xl font-bold text-slate-800">
            {activeTab === 'camera' && 'Monitoramento da Portaria'}
            {activeTab === 'register' && 'Cadastro de Biometria Facial'}
            {activeTab === 'logs' && 'Histórico de Acessos'}
          </h2>
          <div className="flex items-center gap-2 text-sm text-slate-500 bg-slate-100 px-3 py-1.5 rounded-full border border-slate-200">
            <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse"></span>
            Sistema Online
          </div>
        </header>

        {/* Dynamic Content Area */}
        <div className="flex-1 p-6 overflow-y-auto">
          
          {/* TAB: CAMERA (MONITORAMENTO) */}
          {activeTab === 'camera' && (
            <div className="flex flex-col lg:flex-row gap-6 h-full">
              {/* Camera Feed */}
              <div className="flex-1 bg-black rounded-2xl overflow-hidden relative shadow-lg flex items-center justify-center min-h-[400px]">
                <video ref={monitorVideoRef} autoPlay playsInline className="w-full h-full object-cover opacity-80" />
                
                {/* Overlay Scanning UI */}
                <div className="absolute inset-0 pointer-events-none">
                  <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-64 h-64 border-2 border-blue-500/50 rounded-lg">
                    <div className="absolute top-0 left-0 w-4 h-4 border-t-2 border-l-2 border-blue-400"></div>
                    <div className="absolute top-0 right-0 w-4 h-4 border-t-2 border-r-2 border-blue-400"></div>
                    <div className="absolute bottom-0 left-0 w-4 h-4 border-b-2 border-l-2 border-blue-400"></div>
                    <div className="absolute bottom-0 right-0 w-4 h-4 border-b-2 border-r-2 border-blue-400"></div>
                    {/* Scanning Line */}
                    <div className="w-full h-0.5 bg-blue-400/50 absolute top-0 animate-[scan_2s_ease-in-out_infinite]"></div>
                  </div>
                  <div className="absolute top-4 left-4 bg-red-600 text-white text-xs px-2 py-1 rounded flex items-center gap-1 font-bold tracking-wider">
                    <span className="w-2 h-2 rounded-full bg-white animate-pulse"></span> REC
                  </div>
                </div>
              </div>

              {/* Simulation Controls & Recent Events */}
              <div className="w-full lg:w-96 flex flex-col gap-6">
                <div className="bg-white p-5 rounded-2xl shadow-sm border border-slate-200">
                  <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
                    <User size={18} className="text-blue-600"/>
                    Simular Reconhecimento
                  </h3>
                  <p className="text-sm text-slate-500 mb-4">Clique em um aluno para simular que a inteligência artificial detectou o rosto dele na câmera.</p>
                  <div className="space-y-3">
                    {students.map(student => (
                      <button 
                        key={student.id}
                        onClick={() => simulateRecognition(student)}
                        className="w-full flex items-center gap-3 p-3 rounded-xl border border-slate-200 hover:border-blue-500 hover:bg-blue-50 transition-all text-left group"
                      >
                        <img src={student.photo} alt={student.name} className="w-10 h-10 rounded-full object-cover bg-slate-100" />
                        <div>
                          <p className="font-medium text-slate-800 group-hover:text-blue-700">{student.name}</p>
                          <p className="text-xs text-slate-500">Detectar rosto...</p>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>

                <div className="bg-white p-5 rounded-2xl shadow-sm border border-slate-200 flex-1 overflow-hidden flex flex-col">
                  <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
                    <Bell size={18} className="text-blue-600"/>
                    Últimos Alertas
                  </h3>
                  <div className="overflow-y-auto space-y-3 pr-2">
                    {logs.length === 0 ? (
                      <p className="text-sm text-slate-400 text-center py-4">Nenhum movimento hoje.</p>
                    ) : (
                      logs.slice(0, 5).map(log => (
                        <div key={log.id} className="flex gap-3 text-sm border-b border-slate-100 pb-3 last:border-0">
                          <div className={`mt-0.5 w-2 h-2 rounded-full flex-shrink-0 ${log.type === 'Entrada' ? 'bg-green-500' : 'bg-orange-500'}`} />
                          <div>
                            <p className="font-medium">{log.studentName} <span className="text-slate-500 font-normal ml-1">registrou {log.type.toLowerCase()}</span></p>
                            <p className="text-xs text-slate-400 mt-1">{log.time} - Mensagem enviada</p>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* TAB: REGISTER (CADASTRO) */}
          {activeTab === 'register' && (
            <div className="max-w-4xl mx-auto bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
              <div className="flex flex-col md:flex-row">
                {/* Photo Capture */}
                <div className="w-full md:w-1/2 p-6 bg-slate-50 border-r border-slate-200 flex flex-col items-center justify-center">
                  <div className="w-64 h-64 bg-slate-200 rounded-full mb-6 overflow-hidden relative border-4 border-white shadow-lg flex items-center justify-center">
                    {newPhoto ? (
                      <img src={newPhoto} alt="Captured" className="w-full h-full object-cover" />
                    ) : (
                      <video ref={registerVideoRef} autoPlay playsInline className="w-full h-full object-cover transform -scale-x-100" />
                    )}
                    
                    {!newPhoto && (
                      <div className="absolute inset-0 pointer-events-none border-4 border-dashed border-white/50 rounded-full m-4"></div>
                    )}
                  </div>
                  
                  {newPhoto ? (
                     <button type="button" onClick={() => setNewPhoto(null)} className="text-sm text-blue-600 hover:text-blue-800 font-medium">
                       Tirar foto novamente
                     </button>
                  ) : (
                    <button type="button" onClick={handleCapturePhoto} className="flex items-center gap-2 bg-blue-600 text-white px-6 py-2.5 rounded-full hover:bg-blue-700 transition-colors shadow-md">
                      <Camera size={18} />
                      Capturar Rosto
                    </button>
                  )}
                  <p className="text-xs text-slate-500 mt-4 text-center">Para melhor precisão, o aluno deve olhar diretamente para a câmera em um ambiente iluminado.</p>
                </div>

                {/* Form */}
                <form onSubmit={handleRegisterStudent} className="w-full md:w-1/2 p-8 flex flex-col justify-center">
                  <h3 className="text-xl font-semibold mb-6">Dados do Aluno</h3>
                  
                  <div className="space-y-5">
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-1">Nome Completo do Aluno</label>
                      <input 
                        type="text" 
                        value={newName}
                        onChange={(e) => setNewName(e.target.value)}
                        placeholder="Ex: Maria Eduarda Silva"
                        className="w-full px-4 py-2.5 rounded-lg border border-slate-300 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all"
                      />
                    </div>
                    
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-1">WhatsApp dos Responsáveis</label>
                      <input 
                        type="tel" 
                        value={newParentPhone}
                        onChange={(e) => setNewParentPhone(e.target.value)}
                        placeholder="(00) 00000-0000"
                        className="w-full px-4 py-2.5 rounded-lg border border-slate-300 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all"
                      />
                      <p className="text-xs text-slate-500 mt-1">Este número receberá os alertas de entrada e saída.</p>
                    </div>

                    <div className="pt-4">
                      <button type="submit" className="w-full bg-slate-900 text-white font-medium py-3 rounded-lg hover:bg-slate-800 transition-colors shadow-md flex justify-center items-center gap-2">
                        <UserPlus size={18} />
                        Salvar e Treinar IA
                      </button>
                    </div>
                  </div>
                </form>
              </div>
            </div>
          )}

          {/* TAB: LOGS (HISTÓRICO) */}
          {activeTab === 'logs' && (
            <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-200 text-sm text-slate-600">
                      <th className="p-4 font-semibold">Horário</th>
                      <th className="p-4 font-semibold">Aluno</th>
                      <th className="p-4 font-semibold">Evento</th>
                      <th className="p-4 font-semibold">Status de Envio</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {logs.length === 0 ? (
                      <tr>
                        <td colSpan="4" className="p-8 text-center text-slate-500">Nenhum registro encontrado.</td>
                      </tr>
                    ) : (
                      logs.map(log => (
                        <tr key={log.id} className="hover:bg-slate-50">
                          <td className="p-4 text-sm text-slate-600">{log.time}</td>
                          <td className="p-4 font-medium text-slate-800">{log.studentName}</td>
                          <td className="p-4">
                            <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${log.type === 'Entrada' ? 'bg-green-100 text-green-800' : 'bg-orange-100 text-orange-800'}`}>
                              {log.type}
                            </span>
                          </td>
                          <td className="p-4">
                            <div className="flex items-center gap-1.5 text-xs text-green-600 font-medium">
                              <CheckCircle2 size={14} /> Mensagem Entregue
                            </div>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

        </div>
        
        {/* Toast Notification */}
        {toast && (
          <div className={`absolute bottom-6 right-6 p-4 rounded-xl shadow-xl flex items-start gap-3 max-w-sm animate-[slideIn_0.3s_ease-out] z-50 ${toast.type === 'success' ? 'bg-slate-900 text-white' : 'bg-red-50 border-l-4 border-red-500 text-red-800'}`}>
            {toast.type === 'success' ? <CheckCircle2 className="text-green-400 mt-0.5" size={20} /> : <AlertCircle className="text-red-500 mt-0.5" size={20} />}
            <div>
              <p className="font-medium text-sm whitespace-pre-wrap">{toast.message}</p>
            </div>
          </div>
        )}

        <style dangerouslySetInnerHTML={{__html: `
          @keyframes scan {
            0% { top: 0%; opacity: 0; }
            10% { opacity: 1; }
            90% { opacity: 1; }
            100% { top: 100%; opacity: 0; }
          }
          @keyframes slideIn {
            from { transform: translateX(100%); opacity: 0; }
            to { transform: translateX(0); opacity: 1; }
          }
        `}} />
      </main>
    </div>
  );
}
