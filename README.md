## Component Dependencies Listing

To get a list of all of the dependencies of a given component, do this:

- Install madge:
`npm install -g madge`

- then run this from the command line:
`madge --json ./NameOfYourComponent.jsx > output_file.json`
eg:
`cd D:\Devel\cordel-core\trunk\MavSystem\Web\Cordel.Web.Application\assets\client\React\Pages\FileUploadManager`
`madge --json ./FileUploadManager.jsx > fum_deps.json`

## To get copy of the component and its dependencies:
Usage: node dependency-extractor.js <sourcePath> <outputPath>
eg:
`node dependency-extractor.js D:\Devel\cordel-core\trunk\MavSystem\Web\Cordel.Web.Application\assets\client\React\Pages\FileUploadManager\FileUploadManager.js C:\Users\Tony Edwards\copied-deps`
