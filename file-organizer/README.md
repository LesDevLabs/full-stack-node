# file-organizer

CLI для аналізу та впорядкування директорій. 
Node.js 20+

```bash
node file-organizer.js scan <directory>
node file-organizer.js duplicates <directory>
node file-organizer.js organize <source> --output <target>
node file-organizer.js cleanup <directory> --older-than <days> [--confirm]
```

- `scan` - кількість і розмір файлів, групування за розширенням, вік, топ-3 найбільших, найстаріший файл.
- `duplicates` - групи файлів з однаковим SHA-256 і витрачене місце.
- `organize` - копіює файли в `Documents`, `Images`, `Archives`, `Code`, `Videos`, `Other`; при збігу назв додає суфікс `file(1).pdf`.
- `cleanup` - файли, змінені понад `<days>` днів тому. Без `--confirm` лише показує список (dry run).

