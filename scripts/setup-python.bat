@echo off



chcp 65001 >nul



echo === Cai dat VieNeu-TTS v3 cho TTS Batch ===



py -3 --version >nul 2>&1



if errorlevel 1 (



    python --version >nul 2>&1



    if errorlevel 1 (



        echo Loi: Khong tim thay Python. Cai Python 3.10+ tu python.org



        pause



        exit /b 1



    )



    set PY=python



) else (



    set PY=py -3



)



%PY% -m pip install --upgrade pip



%PY% -m pip install -r "%~dp0..\python\requirements.txt"



echo.



echo Xong! Chay npm start de mo ung dung.



pause


