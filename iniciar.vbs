' Inicia o HiddenAgent sem abrir terminal. Dê dois cliques neste arquivo.
' Se já estiver rodando, apenas traz a janela de volta (instância única).
' Argumentos recebidos (ex.: --oculto) são repassados ao app.
Set fso = CreateObject("Scripting.FileSystemObject")
Set sh = CreateObject("WScript.Shell")
sh.CurrentDirectory = fso.GetParentFolderName(WScript.ScriptFullName)
args = ""
For Each a In WScript.Arguments
  args = args & " " & a
Next
sh.Run """node_modules\electron\dist\electron.exe"" ." & args, 0, False
