## Component Dependencies Listing And Extraction

[Read about madge here](https://www.npmjs.com/package/madge)

To just get a list of all of the dependencies of a given component, do this:

- Install madge:
`npm install -g madge`

- then run this from the command line:
`madge --json ./NameOfYourComponent.jsx > output_file.json`

eg:

`cd "C:\Users\USERNAME\code\LibraryListerUI\src\components"`

`madge --json ./BookDisplayCard.jsx > book_display_card_dependencies.json`

Will output this json file:
```{
  "../lib/utils.js": [],
  "../stores/bookstore.js": [],
  "../styles/styles.css": [],
  "BookDisplayCard.jsx": [
    "../lib/utils.js",
    "../stores/bookstore.js",
    "../styles/styles.css"
  ]
}
```

## To get complete copy of the component and its dependencies:
Install the cli tool:
 `npx madge-dependency-extractor`
Usage: node dependency-extractor.js <sourcePath> <outputPath>

eg:
`node dependency-extractor.js "C:\Users\USERNAME\code\LibraryListerUI\src\components\BookDisplayCard.jsx" "C:\Users\USERNAME\Documents\copied-book_display_card"`

Will create a compete file anf folder list of the dependencies of the specified component:
```
+---BookDisplayCard
    ¦   BookDisplayCard.json
    ¦   BookDisplayCard.md
    ¦   
    +---components
    ¦       BookDisplayCard.jsx
    ¦       
    +---lib
    ¦       utils.js
    ¦       
    +---stores
    ¦       bookstore.js
    ¦       
    +---styles
            styles.css
```
The component_name.md markdown file contains a summary of the copied dependencies:
# Dependency Report: BookDisplayCard
*Generated on 20/02/2026*

## Summary
* **Total Files:** 4
* **Circular Dependencies:** ✅ None

## Dependency Details
| File | Depends On |
| :--- | :--- |
| `../lib/utils.js` | _None_ |
| `../stores/bookstore.js` | _None_ |
| `../styles/styles.css` | _None_ |
| `BookDisplayCard.jsx` | `../lib/utils.js`, `../stores/bookstore.js`, `../styles/styles.css` |

