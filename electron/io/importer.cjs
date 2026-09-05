const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');
const TextChunker = require('./text-chunker.cjs');

class Importer {
    /** Chuẩn hóa tên cột Excel để so khớp không phân biệt hoa/thường, dấu, khoảng trắng. */
    static normalizeHeader(key) {
        return String(key || '')
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '_')
            .replace(/^_|_$/g, '');
    }

    static rowByHeader(row) {
        const map = {};
        for (const [key, value] of Object.entries(row)) {
            map[Importer.normalizeHeader(key)] = value;
        }
        return map;
    }

    static pickCell(rowMap, aliases) {
        for (const alias of aliases) {
            const val = rowMap[Importer.normalizeHeader(alias)];
            if (val !== undefined && val !== null && String(val).trim() !== '') {
                return String(val).trim();
            }
        }
        return '';
    }

    static parseNumber(str) {
        const match = String(str).match(/(\d+)/);
        return match ? parseInt(match[1], 10) : Infinity;
    }

    static sortByNumber(items) {
        return items.sort((a, b) => {
            const numA = Importer.parseNumber(path.basename(a));
            const numB = Importer.parseNumber(path.basename(b));
            if (numA !== numB) return numA - numB;
            return path.basename(a).localeCompare(path.basename(b));
        });
    }

    static getTxtFilesInDir(dirPath) {
        try {
            return Importer.sortByNumber(
                fs.readdirSync(dirPath, { withFileTypes: true })
                    .filter((e) => e.isFile() && e.name.toLowerCase().endsWith('.txt'))
                    .map((e) => path.join(dirPath, e.name))
            );
        } catch (_) {
            return [];
        }
    }

    static toRow({ text, nameSave = '', group = '' }) {
        return {
            text: String(text || '').trim(),
            nameSave: String(nameSave || '').trim(),
            group: String(group || '').trim(),
        };
    }

    static async importFromFolder(folderPath) {
        if (!fs.existsSync(folderPath)) throw new Error(`Thư mục không tồn tại: ${folderPath}`);
        if (!fs.statSync(folderPath).isDirectory()) throw new Error(`Đường dẫn không phải thư mục: ${folderPath}`);

        const results = [];
        const entries = fs.readdirSync(folderPath, { withFileTypes: true });
        const subDirs = Importer.sortByNumber(entries.filter((e) => e.isDirectory()).map((e) => path.join(folderPath, e.name)));
        const rootTxts = Importer.getTxtFilesInDir(folderPath);
        const parentGroup = path.basename(folderPath);

        if (rootTxts.length === 1) {
            results.push(Importer.toRow({
                text: fs.readFileSync(rootTxts[0], 'utf-8'),
                nameSave: path.basename(rootTxts[0], '.txt'),
                group: subDirs.length ? parentGroup : '',
            }));
        } else {
            for (const txtFile of rootTxts) {
                results.push(Importer.toRow({
                    text: fs.readFileSync(txtFile, 'utf-8'),
                    nameSave: path.basename(txtFile, '.txt'),
                    group: subDirs.length ? parentGroup : '',
                }));
            }
        }

        for (const subDir of subDirs) {
            const subTxts = Importer.getTxtFilesInDir(subDir);
            for (const txtFile of subTxts) {
                results.push(Importer.toRow({
                    text: fs.readFileSync(txtFile, 'utf-8'),
                    nameSave: path.basename(txtFile, '.txt'),
                    group: parentGroup,
                }));
            }
        }

        return results.filter((r) => r.text);
    }

    static async importFromExcel(filePath) {
        if (!fs.existsSync(filePath)) throw new Error(`File không tồn tại: ${filePath}`);

        const workbook = XLSX.readFile(filePath);
        const sheetName = workbook.SheetNames[0];
        if (!sheetName) throw new Error('File Excel không có sheet nào.');

        const data = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { defval: '' });
        if (!data.length) throw new Error('File Excel rỗng.');

        const results = [];
        for (const row of data) {
            const cells = Importer.rowByHeader(row);

            const text = Importer.pickCell(cells, [
                'Text', 'Prompt', 'Content', 'Nội dung', 'Nội dung văn bản',
                'Noi dung', 'Noi dung van ban', 'Van ban', 'Văn bản',
            ]) || String(Object.values(row)[0] || '').trim();
            if (!text) continue;

            const nameSave = Importer.pickCell(cells, [
                'Name Save', 'NameSave', 'name save', 'Tên file', 'Ten file',
                'File name', 'Filename', 'Name', 'Tên', 'Ten',
            ]);

            const group = Importer.pickCell(cells, [
                'Group', 'Nhóm', 'Nhom', 'Chapter', 'Chương', 'Chuong',
            ]);

            results.push(Importer.toRow({ text, nameSave, group }));
        }
        return results;
    }

    static async importFromTxt(filePaths) {
        const results = [];
        for (const filePath of filePaths) {
            if (!fs.existsSync(filePath)) continue;
            const text = fs.readFileSync(filePath, 'utf-8').trim();
            if (!text) continue;
            results.push(Importer.toRow({
                text,
                nameSave: path.basename(filePath, path.extname(filePath)),
            }));
        }
        return results;
    }

    static async createExcelTemplate(outputPath) {
        const wb = XLSX.utils.book_new();

        Importer.#addDataSheet(wb);
        Importer.#addGuideSheet(wb);

        XLSX.writeFile(wb, outputPath);
    }

    static #addDataSheet(wb) {
        const data = [
            ['Nội dung văn bản', 'Tên file', 'Nhóm'],
            ['Xin chào, đây là dòng ví dụ — bạn có thể xoá dòng này.', 'vi-du-01', ''],
        ];
        const ws = XLSX.utils.aoa_to_sheet(data);
        ws['!cols'] = [{ wch: 70 }, { wch: 22 }, { wch: 18 }];
        ws['!freeze'] = { xSplit: 0, ySplit: 1 };
        Importer.#styleHeader(ws, 3);
        Importer.#addCellNote(ws, 'A1', 'Bắt buộc. Mỗi dòng = 1 file audio đầu ra.');
        Importer.#addCellNote(ws, 'B1', 'Tùy chọn. Tên file audio (không cần gõ đuôi .wav/.mp3). Bỏ trống sẽ tự đặt tên.');
        Importer.#addCellNote(ws, 'C1', 'Tùy chọn. Nhãn phân loại (Chương 1, Tập 2…). Cùng nhóm sẽ lưu chung thư mục con.');
        XLSX.utils.book_append_sheet(wb, ws, 'Danh sách');
    }

    static #addGuideSheet(wb) {
        const rows = [
            ['KHEPREE TTS BATCH AI — HƯỚNG DẪN FILE MẪU'],
            [],
            ['Mục đích'],
            ['File Excel này giúp bạn nhập nhiều đoạn văn bản vào phần mềm cùng một lúc. Mỗi dòng trong bảng sẽ được chuyển thành MỘT file audio.'],
            [],
            ['Cách dùng (4 bước)'],
            ['Bước 1. Mở sheet "Danh sách" — đây là sheet đầu tiên, bên trái thanh dưới cùng.'],
            ['Bước 2. Hàng đầu tiên là tiêu đề — giữ nguyên, không sửa.'],
            ['Bước 3. Xoá dòng ví dụ (hàng số 2). Từ hàng số 3 trở đi, gõ hoặc dán nội dung của bạn vào cột "Nội dung văn bản".'],
            ['Bước 4. Lưu file (.xlsx) rồi mở phần mềm → bấm nút "Import Excel".'],
            [],
            ['Ý nghĩa từng cột'],
            [],
            ['Cột "Nội dung văn bản" — BẮT BUỘC'],
            ['Đây là văn bản sẽ được máy đọc thành giọng nói.'],
            ['• Có thể gõ tiếng Việt có dấu, tiếng Anh, hoặc trộn lẫn cả hai.'],
            ['• Một dòng có thể chứa nội dung dài nhiều trang — phần mềm sẽ tự xử lý.'],
            ['• Ví dụ: "Hôm nay trời đẹp quá."'],
            [],
            ['Cột "Tên file" — KHÔNG BẮT BUỘC'],
            ['Đây là tên file audio sau khi xuất ra (phần mềm tự thêm đuôi .wav hoặc .mp3).'],
            ['• Ví dụ: gõ "bai-01" → file xuất ra sẽ là "bai-01.wav".'],
            ['• Nếu bỏ trống: phần mềm tự đặt tên theo số thứ tự.'],
            ['• Nên dùng chữ thường, không dấu, gạch ngang hoặc gạch dưới. Ví dụ: chuong-01, tap-2, bai_giang_01.'],
            [],
            ['Cột "Nhóm" — KHÔNG BẮT BUỘC'],
            ['Dùng để phân loại các dòng (ví dụ: Chuong-1, Tap-2, Thong-bao…).'],
            ['• Các dòng cùng nhóm sẽ được lưu vào cùng một thư mục con trong thư mục xuất.'],
            ['• Nếu bỏ trống: tất cả file sẽ lưu chung vào một thư mục.'],
            [],
            ['Mẹo xử lý tiếng Việt'],
            ['• Nếu văn bản có chứa số, ngày tháng, tiền tệ (ví dụ: "1.250.000 đồng", "ngày 15/3/2026"), hãy bật tuỳ chọn "sea-g2p" trong phần Cài đặt của phần mềm để máy đọc cho chính xác.'],
            ['• Muốn máy đọc có khoảng lặng giữa các đoạn văn, hãy xuống dòng trong ô bằng phím Alt + Enter.'],
            ['• Dòng trống sẽ được bỏ qua, không gây lỗi.'],
            [],
            ['Câu hỏi thường gặp'],
            [],
            ['Hỏi: Tôi muốn tạo 100 file audio thì cần gõ 100 dòng à?'],
            ['Đáp: Đúng vậy. Mỗi dòng = 1 file. Bạn có thể copy/paste hàng loạt từ Word, Google Docs, hoặc từ bất kỳ danh sách văn bản nào.'],
            [],
            ['Hỏi: Tôi lỡ gõ nhầm tên cột, sửa lại được không?'],
            ['Đáp: Được. Cứ sửa bình thường rồi lưu file, import lại.'],
            [],
            ['Hỏi: Nhiều dòng trùng tên file thì sao?'],
            ['Đáp: Phần mềm tự động thêm số phía sau (ví dụ: bai-01_1, bai-01_2…) để không bị ghi đè.'],
            [],
            ['Hỏi: Mở file báo lỗi "không đọc được"?'],
            ['Đáp: Kiểm tra file có đuôi .xlsx. Nếu là .xls (Excel cũ) hoặc file CSV, hãy mở bằng Excel rồi lưu lại dưới dạng .xlsx.'],
            [],
            ['Hỏi: Tôi muốn xoá hết ví dụ và bắt đầu lại từ đầu?'],
            ['Đáp: Chỉ cần giữ lại hàng tiêu đề (hàng 1), xoá tất cả các hàng bên dưới rồi nhập mới.'],
        ];
        const ws = XLSX.utils.aoa_to_sheet(rows);
        ws['!cols'] = [{ wch: 100 }];
        Importer.#styleHeader(ws, 1, 1);
        Importer.#styleGuideSection(ws);
        XLSX.utils.book_append_sheet(wb, ws, 'Hướng dẫn');
    }

    static #styleHeader(ws, cols = 1, row = 1) {
        for (let c = 0; c < cols; c += 1) {
            const addr = XLSX.utils.encode_cell({ r: row - 1, c });
            const cell = ws[addr];
            if (!cell) continue;
            cell.s = {
                font: { bold: true, color: { rgb: 'FFFFFFFF' }, sz: 12 },
                fill: { fgColor: { rgb: 'FF2F5496' } },
                alignment: { horizontal: 'left', vertical: 'center', wrapText: true },
            };
        }
    }

    static #styleGuideSection(ws) {
        const sectionTitles = new Set([
            'Mục đích',
            'Cách dùng (4 bước)',
            'Ý nghĩa từng cột',
            'Mẹo xử lý tiếng Việt',
            'Câu hỏi thường gặp',
        ]);
        const range = XLSX.utils.decode_range(ws['!ref'] || 'A1');
        for (let r = range.s.r; r <= range.e.r; r += 1) {
            const addr = XLSX.utils.encode_cell({ r, c: 0 });
            const cell = ws[addr];
            if (!cell) continue;
            if (sectionTitles.has(cell.v)) {
                cell.s = {
                    font: { bold: true, color: { rgb: 'FF1F3864' }, sz: 12 },
                    alignment: { vertical: 'center' },
                };
            }
        }
    }

    static #addCellNote(ws, addr, note) {
        const cell = ws[addr];
        if (!cell) return;
        cell.c = [{ t: note, a: 'Khepree' }];
    }

    static bundledTemplatePath(rootDir) {
        return path.join(rootDir, 'samples', 'mau-voxbatch.xlsx');
    }

    /** Tách các dòng import quá dài thành nhiều tác vụ batch. */
    static applyChunkOptions(rows, options = {}) {
        if (!options.chunkAutoOnImport) return rows;
        return TextChunker.expandImportRows(rows, {
            maxChars: options.chunkMaxChars || TextChunker.DEFAULTS.maxChars,
            thresholdChars: options.chunkMaxChars || TextChunker.DEFAULTS.maxChars,
        });
    }
}

module.exports = Importer;
