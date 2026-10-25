import re

with open(r'c:\Users\Joehk\OneDrive\Couse\Project\小行星網店\LittlePlanet\public\index.html', 'r', encoding='utf-8') as f:
    content = f.read()

# Fix duplicate function definition by removing the second one
# Find the first occurrence of the function start
first_func_start = content.find('function openQuickView(productData) {')
if first_func_start != -1:
    # Find the end of the first function (matching braces)
    brace_count = 0
    found_open = False
    func_end = first_func_start
    
    # Look for the closing brace of the first function
    # We'll find the next occurrence of "// Event listeners for modal controls"
    first_section_end = content.find('// Event listeners for modal controls', first_func_start)
    if first_section_end != -1:
        # Extract the first function section
        first_section = content[first_func_start:first_section_end]
        
        # Also extract the content after the first function section
        after_first_section = content[first_section_end:]
        
        # Now extract the "closeModalBtn" line and later content
        closeModal_start = after_first_section.find('const closeModalBtn = document.getElementById(\'quickViewCloseBtn\');')
        if closeModal_start != -1:
            # Combine the parts
            content = first_section + '\n   ' + after_first_section[closeModal_start:]
            print('Fixed duplicate function definition')

with open(r'c:\Users\Joehk\OneDrive\Couse\Project\小行星網店\LittlePlanet\public\index.html', 'w', encoding='utf-8') as f:
    f.write(content)

print('Cleanup completed successfully!')
EOF