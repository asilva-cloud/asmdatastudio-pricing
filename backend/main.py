from fastapi import FastAPI, UploadFile, Depends, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import HTTPBearer, HTTPAuthCredentials
import pandas as pd
import numpy as np
from scipy import stats
import anthropic
from supabase import create_client
import os
from dotenv import load_dotenv
import io

load_dotenv()

supabase_url = os.getenv("SUPABASE_URL")
supabase_key = os.getenv("SUPABASE_ANON_KEY")
supabase_client = create_client(supabase_url, supabase_key)

anthropic_client = anthropic.Anthropic(api_key=os.getenv("ANTHROPIC_API_KEY"))

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

security = HTTPBearer()

@app.post("/api/auth/signup")
async def signup(email: str, password: str):
    try:
        response = supabase_client.auth.sign_up({
            "email": email,
            "password": password
        })
        return {
            "success": True,
            "user_id": response.user.id,
            "message": "Usuario creado"
        }
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@app.post("/api/auth/login")
async def login(email: str, password: str):
    try:
        response = supabase_client.auth.sign_in_with_password({
            "email": email,
            "password": password
        })
        return {
            "success": True,
            "access_token": response.session.access_token,
            "user_id": response.user.id
        }
    except Exception as e:
        raise HTTPException(status_code=401, detail="Credenciales inválidas")

def verify_token(credentials: HTTPAuthCredentials = Depends(security)):
    token = credentials.credentials
    try:
        user = supabase_client.auth.get_user(token)
        return user
    except:
        raise HTTPException(status_code=401, detail="Token inválido")

@app.post("/api/analizar")
async def analizar_elasticidad(file: UploadFile, user = Depends(verify_token)):
    try:
        contents = await file.read()
        df = pd.read_csv(io.StringIO(contents.decode('utf-8')))
        
        required_cols = ['precio', 'volumen_vendido', 'costo_unitario']
        if not all(col in df.columns for col in required_cols):
            raise ValueError(f"Falta columnas. Necesitas: {required_cols}")
        
        df = df[df['precio'] > 0]
        df = df[df['volumen_vendido'] > 0]
        
        X = np.log(df['precio'].values)
        y = np.log(df['volumen_vendido'].values)
        
        slope, intercept, r_value, p_value, std_err = stats.linregress(X, y)
        
        elasticidad = slope
        r_squared = r_value ** 2
        precio_promedio = df['precio'].mean()
        volumen_promedio = df['volumen_vendido'].mean()
        costo_promedio = df['costo_unitario'].mean()
        margen_actual = (precio_promedio - costo_promedio) * volumen_promedio
        
        try:
            supabase_client.table('analisis').insert({
                'user_id': user.id,
                'filename': file.filename,
                'elasticidad': float(elasticidad),
                'r_squared': float(r_squared),
                'precio_promedio': float(precio_promedio),
                'volumen_promedio': float(volumen_promedio),
                'costo_promedio': float(costo_promedio),
                'margen_actual': float(margen_actual)
            }).execute()
        except:
            pass
        
        return {
            "success": True,
            "elasticidad": float(elasticidad),
            "r_squared": float(r_squared),
            "interpretacion": f"Una baja de precio del 1% aumenta volumen {abs(elasticidad):.2f}%",
            "precio_promedio": float(precio_promedio),
            "volumen_promedio": float(volumen_promedio),
            "costo_promedio": float(costo_promedio),
            "margen_actual": float(margen_actual),
            "rows_analizadas": len(df)
        }
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@app.post("/api/simular")
async def simular_precio(
    nuevo_precio: float,
    elasticidad: float,
    precio_actual: float,
    volumen_actual: float,
    costo_unitario: float,
    user = Depends(verify_token)
):
    pct_cambio_precio = (nuevo_precio - precio_actual) / precio_actual
    pct_cambio_volumen = elasticidad * pct_cambio_precio
    nuevo_volumen = volumen_actual * (1 + pct_cambio_volumen)
    
    margen_unitario = nuevo_precio - costo_unitario
    margen_total = margen_unitario * nuevo_volumen
    ingresos = nuevo_precio * nuevo_volumen
    
    margen_actual_total = (precio_actual - costo_unitario) * volumen_actual
    pct_cambio_margen = ((margen_total - margen_actual_total) / margen_actual_total) * 100
    
    return {
        "nuevo_precio": float(nuevo_precio),
        "nuevo_volumen": float(nuevo_volumen),
        "margen_unitario": float(margen_unitario),
        "margen_total": float(margen_total),
        "ingresos": float(ingresos),
        "pct_cambio_margen": float(pct_cambio_margen),
        "pct_cambio_volumen": float(pct_cambio_volumen) * 100
    }

@app.post("/api/recomendar")
async def obtener_recomendacion(datos: dict, user = Depends(verify_token)):
    prompt = f"""
    Datos de sensibilidad:
    - Elasticidad: {datos['elasticidad']:.2f}
    - Precio actual: ${datos['precio_actual']:.2f}
    - Volumen: {datos['volumen_actual']:.0f}
    - Costo: ${datos['costo_unitario']:.2f}
    
    Escenarios:
    {datos['escenarios_texto']}
    
    ¿Precio óptimo para maximizar margen? Sé específico.
    """
    
    message = anthropic_client.messages.create(
        model="claude-opus-4-6",
        max_tokens=500,
        messages=[{"role": "user", "content": prompt}]
    )
    
    return {"recomendacion": message.content[0].text}

@app.get("/api/health")
async def health():
    return {"status": "ok"}
