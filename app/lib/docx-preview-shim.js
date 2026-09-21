/* docx-preview и docx (выгрузка в Word) оба называют себя window.docx.
   Сохраняем просмотрщик под своим именем и освобождаем место для второй библиотеки. */
window.docxPreview = window.docx;
try { delete window.docx; } catch (e) { window.docx = undefined; }
