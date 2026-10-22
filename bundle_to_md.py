import os

# 設定要排除的資料夾
EXCLUDE_DIRS = {'node_modules', '.git', 'dist', 'build', '.next'}
# 設定要排除的副檔名或敏感檔案（保護 .env 不外洩）
EXCLUDE_EXTS = {'.png', '.jpg', '.jpeg', '.gif', '.ico', '.pdf', '.zip'}
EXCLUDE_FILES = {'.env', '.env.example', 'package-lock.json'}


def generate_project_markdown(root_dir, output_file):
  with open(output_file, 'w', encoding='utf-8') as outfile:
    outfile.write(f'# Project Overview: {os.path.basename(root_dir)}\n\n')
    outfile.write('## 目錄結構與檔案內容備份\n\n')

    for dirpath, dirnames, filenames in os.walk(root_dir):
      # 排除特定資料夾
      dirnames[:] = [d for d in dirnames if d not in EXCLUDE_DIRS]

      for file in filenames:
        if file in EXCLUDE_FILES:
          continue
        ext = os.path.splitext(file)[1].lower()
        if ext in EXCLUDE_EXTS:
          continue

        file_path = os.path.join(dirpath, file)
        rel_path = os.path.relpath(file_path, root_dir)

        # 寫入檔案標題與內容
        outfile.write(f'### File: `{rel_path}`\n\n')
        outfile.write('```\n')
        try:
          with open(file_path, 'r', encoding='utf-8', errors='ignore') as f:
            outfile.write(f.read())
        except Exception as e:
          outfile.write(f'[無法讀取檔案內容: {e}]')
        outfile.write('\n```\n\n---\n\n')

  print(f'成功！整個專案已打包至: {output_file}')


if __name__ == '__main__':
  generate_project_markdown('.', 'project_summary.md')